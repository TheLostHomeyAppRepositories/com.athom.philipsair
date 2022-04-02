(function () {

    const https = require('http')
    var aesjs = require('aes-js');
    var bigInt = require("big-integer");
    var pkcs7 = require('pkcs7');
    
    let a = bigInt('35315308132206205938053219356172167184243234521329128101814628093311586402304');
    let G = bigInt('A4D1CBD5C3FD34126765A442EFB99905F8104DD258AC507FD6406CFF14266D31266FEA1E5C41564B777E690F5504F213160217B4B01B886A5E91547F9E2749F4D7FBD7D3B9A92EE1909D0D2263F80A76A6A24C087A091F531DBF0A0169B6A28AD662A4D18E73AFA32D779D5918D08BC8858F4DCEF97C2A24855E6EEB22B3B2E5', 16)
    let P = bigInt('B10B8F96A080E01DDE92DE5EAE5D54EC52C99FBCFB06A3C69A6A9DCA52D23B616073E28675A23D189838EF1E2EE652C013ECB4AEA906112324975C3CD49B83BFACCBDD7D90C4BD7098488E9C219A73724EFFD6FAE5644738FAA31A4FF55BCCC0A151AF5F0DC8B4BD45BF37DF365C1A65E68CFDA76D4DA708DF1FB2BC2E4A4371', 16)

    var philipsair = exports;

    let key_128 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const iv = new Uint8Array(key_128);

    function aes_decrypt2(data, key) {
        var aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
        var decryptedBytes = aesCbc.decrypt(data);
        return decryptedBytes;
    }

    function aes_encrypt2(data, key) {
        var aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
        var encryptedBytes = aesCbc.encrypt(data); 
        return Buffer.from(encryptedBytes).toString('base64');
    }
       

    function clean(data) {
        data = data.trimRight().replace(/\\n/g, "\\n")  
        .replace(/\\'/g, "\\'")
        .replace(/\\"/g, '\\"')
        .replace(/\\&/g, "\\&")
        .replace(/\\r/g, "\\r")
        .replace(/\\t/g, "\\t")
        .replace(/\\b/g, "\\b")
        .replace(/\\f/g, "\\f");
        // remove non-printable and other non-valid JSON chars
        console.log("clean " + data);
        data = data.replace(/[\u0000-\u0019]+/g,""); 
        return JSON.parse(data);
    } 

    // active functions()  -------------------------------------  active functions()  --------------------------------------------

    philipsair.getInitData = function getInitData(settings) {
        console.log("settings " +  JSON.stringify(settings));
        
        return new Promise((resolve, reject) => {
            getSecretData(settings, (error, jsonobj) => {
                if (jsonobj) {
                    resolve(jsonobj);
                } else {
                    reject(error);
                }
            });
        });
    }

    philipsair.getCurrentStatusData = function getCurrentStatusData(settings) {
        console.log("settings " +  JSON.stringify(settings));
        
        return new Promise((resolve, reject) => {
            getCurrentData(settings, (error, jsonobj) => {
                if (jsonobj) {
                    resolve(jsonobj);
                } else {
                    reject(error);
                }
            });
        });
    }

    philipsair.setValueAirData = function setValueAirData(value, settings) {
        console.log("value "+ value)
        console.log("settings " +  JSON.stringify(settings));
        
        return new Promise((resolve, reject) => {
            setValueData(value, settings, (error, jsonobj) => {
                if (jsonobj) {
                    resolve(jsonobj);
                } else {
                    reject(error);
                }
            });
        });
    }

    function getSecretData(settings, callback) {
        console.log("getData " + settings.ipkey + " secret " + settings.secretkey );
        let A = G.modPow(a,P)
        let objA = { "diffie":A.toString(16)}
        let json = JSON.stringify(objA);    
    
        const options = {
            protocol: 'http:',
            path: '/di/v1/products/0/security',
            method: 'PUT',
            headers: {
            'Content-Type': 'application/json',
            'Content-Length': json.length
            }
        }

        options.hostname = settings.ipkey;

        const req = https.request(options, res => {
            console.log("exchange keys");    
            console.log('-------------------')    
            console.log(`statusCode: ${res.statusCode}`)

            let body = "";
            res.on("data", data => {
              body += data;
            });
            res.on("end", () => {                
                if (res.statusCode == 200 ){
                    try {
                        respJson = JSON.parse(body.toString());
                        let key = respJson.key
                        console.log("key: " + key)
                        console.log("hellman: " + respJson.hellman)
                        let hellman = bigInt(respJson.hellman, 16)
                        let secret = hellman.modPow(a,P)
                        let sharedSecret = aes_decrypt2(Buffer.from(key,'hex'), Buffer.from(secret.toString(16), 'hex').slice(0,16));
                        sharedSecret = sharedSecret.slice(0,16);
                        sharedSecretText = aesjs.utils.hex.fromBytes(sharedSecret);
                    }
                    catch(error) {
                        sharedSecretText = "ERROR";
                    }
                    // console.log("sharedSecret: " + sharedSecretText);
                } else {
                    sharedSecretText = "ERROR";
                }    
                return callback(null, sharedSecretText); 
            })
        })
          
        req.on('error', error => {
            console.log('error' + error);
            req.abort();
            return callback(null, "ERROR"); 
        })
        req.on('timeout', function () {
            console.log('timeout');
            req.abort();
            return callback(null, "ERROR"); 
          }
        );
        req.setTimeout(3000);
        req.write(json)
        req.end()
    }

    function sendRequest(url, hostname, callback) {

        const options = {
            protocol: 'http:',
            method: 'GET',
            headers: {
            }
        }
        options.hostname = hostname;
        options.path = url;
        
        const reqX = https.request(options, resX => {
            // console.log('-------------------')
            let body = "";
            resX.on("data", data => {
              body += data;
            });
            resX.on("end", () => {
                console.log(body.toString('ascii'));
                let payload = new Buffer.from(body.toString('ascii'), 'base64');
                let data = aes_decrypt2(payload,Buffer.from(sharedSecretText, 'hex'));
                let dataText = aesjs.utils.utf8.fromBytes(data.slice(2));
                let json = "";
                try {
                    json = clean(dataText);
                }
                catch(error) {
                    console.error(error);
                    json = "Error status"
                }
                // console.log(json); 
                // console.log('-------------------')
                return callback(null, json); 
            });
        })  
        
        reqX.on('error', error => {
            console.error(error)
        })
        reqX.end()
    }    

   async function getCurrentData(settings, callback) {
        console.log("getCurrentData " + settings.ipkey + " secret " + settings.secretkey );
        
        let jsonStatus = null;
        let jsonFilter = null;
        let jsonFirmware = null;
        let jsonError = null;

      await  new Promise((resolve, reject) => {
            sendRequest('/di/v1/products/1/air', settings.ipkey, (error, jsonobj) => {
                if (jsonobj) {
                    resolve(jsonobj);
                    jsonStatus = jsonobj;
                } else {
                    reject(error);
                    jsonError = "Error status"
                }
            });
        });        

       await new Promise((resolve, reject) => {
                sendRequest('/di/v1/products/0/firmware', settings.ipkey, (error, jsonobj) => {
                    if (jsonobj) {
                        resolve(jsonobj);
                        jsonFirmware = jsonobj;
                    } else {
                        reject(error);
                        jsonError = "Error firmware"
                    }
                });
        });        


     await   new Promise((resolve, reject) => {
                sendRequest('/di/v1/products/1/fltsts', settings.ipkey, (error, jsonobj) => {
                    if (jsonobj) {
                        resolve(jsonobj);
                        jsonFilter = jsonobj;
                    } else {
                        reject(error);
                        jsonError = "Error filter"
                    }
                });
        });        

            var response = {
                status: jsonStatus,
                firmware: jsonFirmware,
                filter: jsonFilter,
                error: jsonError
            };
            return callback(null, response); 
    }

    function setValueData(value, settings, callback) {
        console.log("setValueData " + settings.ipkey + " secret " + settings.secretkey );

        let jsonValues = 'AA' + value;
        console.log(jsonValues); 
        let dataBytes = pkcs7.pad(aesjs.utils.utf8.toBytes(jsonValues));
        console.log(dataBytes); 
        dataBytesEncrypted = aes_encrypt2(dataBytes, Buffer.from(settings.secretkey, 'hex'));
        console.log(dataBytesEncrypted);

        const optionsPut2 = {
            protocol: 'http:',
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': dataBytesEncrypted.length
            }
        }
        optionsPut2.hostname = settings.ipkey;
        optionsPut2.path = '/di/v1/products/1/air';
        
        const req10 = https.request(optionsPut2, res10 => {
            // console.log("put Values");    
            // console.log('-------------------')
            // console.log(`statusCode: ${res10.statusCode}`)
            let body = "";
            res10.on("data", data => {
              body += data;
            });
            res10.on("end", () => {
                if (res10.statusCode == 200 ){
                    console.log(body.toString('ascii'));
                    let payload = new Buffer.from(body.toString('ascii'), 'base64');
                    let data = aes_decrypt2(payload,Buffer.from(settings.secretkey, 'hex'));
                    let dataText = aesjs.utils.utf8.fromBytes(data.slice(2));
                    let json = clean(dataText);
                    console.log(json); 
                    // console.log('-------------------')
                    return callback(null, json); 
                }
            })
        })  
        
        req10.on('error', error => {
            console.error(error)
        })
        req10.write(dataBytesEncrypted)
        req10.end()
    }
})();