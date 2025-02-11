
console.log("pollAirCoapDevice");
console.log("getCurrentStatusDataCoap");

const coap = require("node-coap-client").CoapClient;
const origin = require('node-coap-client/build/lib/Origin');
const crypto = require('crypto');
var aesjs = require('aes-js');
var pkcs7 = require('pkcs7');

var sharedKey = 'JiangPan';

var statusCounter = 0;
var controlCounter = 0;

function decodeCounter(encodedCounter) {
    let counterUpperCase = encodedCounter.toUpperCase();
    let length = counterUpperCase.length;

    let counter = 0;
    for (let i = length; i > 0; i--) {
        let charAt = counterUpperCase.charAt(i - 1);
        counter = (counter) + Math.pow(16.0, length - i) * ((charAt < '0' || charAt > '9') ? charAt.charCodeAt(0) - '7'.charCodeAt(0) : charAt.charCodeAt(0) - '0'.charCodeAt(0));
    }
    return counter;
}

function encodeCounter(counter, length) {
    let hex = counter.toString(16);
    if (hex.length % 2 === 1) {
        hex = '0' + hex;
    }
    return prependZero(hex.toUpperCase(), length);
}

function prependZero(value, length) {
    let result = '';
    for (let i = 0; i < length - value.length; i++) {
        result = '0' + result;
    }
    return (result + value).substring(0, length);
}
function toMD5(value) {
    return crypto.createHash('md5').update(value).digest();
}

function toSha256(value) {
    return crypto.createHash('sha256').update(value).digest();
}

function aes_decrypt2(data, key, iv) {
    var aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
    var decryptedBytes = aesCbc.decrypt(data);
    return decryptedBytes;
}

function aes_encrypt2(data, key, iv) {
    var segmentSize = 16;
    var aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
    var encryptedBytes = aesCbc.encrypt(data);
    return encryptedBytes;
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
    data = data.replace(/[\u0000-\u0019]+/g, "");
    return JSON.parse(data);
}


function getCurrentStatusDataCoap(uri) {
    return new Promise(async (resolve, reject) => {
        await getCurrentDataCoap(uri, (error, jsonobj) => {
            if (jsonobj) {
                console.log('getCurrentDataCoap res ', jsonobj)
                resolve(jsonobj);
            } else {
                console.log('2: ' + error);
                reject(error);
            }
        });
    }).catch(reason => console.log('1: ' + reason));
}

// sleep time expects milliseconds
function sleep(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}

async function getCurrentDataCoap(uri, callback) {
    var target = new origin.Origin('coap:', uri, 5683);
    var targetString = 'coap://' + uri + ':5683';

    let jsonStatus = null;
    console.log('target res ', uri);
    coap.request(targetString + '/sys/dev/sync', 'post',
        Buffer.from(encodeCounter(statusCounter, 8)), { keepAlive: true })
        .then(response => {
            if (response.payload) {
                const payload = response.payload.toString('utf-8');
                controlCounter = decodeCounter(payload);
                console.log(controlCounter);

            } else {
                let error = new Error('No response received for sync call. Cannot proceed, is coap://' + uri + ':5683 up');
                coap.reset(target);
                return callback(error, null);
            }
        }).catch(err => {
            console.log(err);
            let error = new Error('catch: No response received for sync call. Cannot proceed, is coap://' + uri + ':5683 up');
            coap.reset(target);
            return callback(error, null);
        });

    const connectResult = await coap.tryToConnect(target);

    await coap.observe(targetString + '/sys/dev/status', 'get', resp => {
        console.log('target observe ', targetString);
        if (resp.payload) {
            const response = resp.payload.toString('utf-8');
            const encodedCounter = response.substring(0, 8);
            let counter = decodeCounter(encodedCounter);
            console.log("counter " + counter);
            const hash = response.substring(response.length - 64);
            const encodedMessageAndCounter = response.substring(0, response.length - 64);
            // console.log(encodedMessageAndCounter);
            const hashedMessage = Buffer.from(toSha256(encodedMessageAndCounter)).toString('hex').toUpperCase();

            if (counter < 1 || counter > 2000000000 ||
                ((counter < statusCounter && statusCounter < 2000000000 - 10) ||
                    ((counter > statusCounter + 10 && counter < 2000000000) ||
                        (2000000000 - statusCounter < 10 && counter < statusCounter &&
                            (10 - (2000000000 - statusCounter)) + 1 < counter && counter < statusCounter)))) {
                console.log('Invalid message id');
            }
            if (hash !== hashedMessage) {
                console.log('Invalid message hash');
            }
            if (counter >= 2000000000) {
                counter = 1;
            }

            statusCounter = counter;

            let keyAndIv = toMD5(sharedKey + encodedCounter).toString('hex').toUpperCase();
            // console.log("keyAndIv " + keyAndIv);
            const secretKey = keyAndIv.substring(0, keyAndIv.length / 2);
            // console.log("secret " + secretKey);
            const iv = keyAndIv.substring(keyAndIv.length / 2, keyAndIv.length);
            // console.log("iv " + iv);

            const encodedMessage = response.substring(8, response.length - 64);

            let payload = new Buffer.from(encodedMessage, 'hex');
            let data = aes_decrypt2(payload, Buffer.from(secretKey, 'utf-8'), Buffer.from(iv, 'utf-8'));
            let dataText = aesjs.utils.utf8.fromBytes(data);
            jsonStatus = clean(dataText).state.reported;
            console.log(jsonStatus);
            // console.log('-------stopObserving------------')
            // coap.stopObserving('coap://' + "192.168.178.44" + ':5683/sys/dev/status')
            // console.log('---------end----------');
        }

    }, undefined, {
        confirmable: false, // we expect no answer here in the typical coap way.
        retransmit: true
    }).then(() => {
        // TODO: nothing?
    }).catch(reason => console.log(reason));

    // sleep(300000).then(() => {
    //     console.log('--------reset-----------');
    //     coap.reset(target);
    //     console.log('---------end----------');
    // });

    setTimeout(function () {
        var response = {
            status: jsonStatus
        };
        coap.stopObserving('coap://' + uri + ':5683/sys/dev/status');
        coap.reset(target);
        console.log('---------timeout----------');
        if (jsonStatus != null) {
            return callback(null, response);
        } else {
            return callback(new Error('No response received'), null);
        }
    }, 60000)
}


// getCurrentStatusDataCoap("192.168.107.196").then(data => {
//     if (data != null) {
//         console.log("pollAirCoapDevice: " + JSON.stringify(data));
//         let json = data.status
//     } else {
//         console.log("pollAirCoapDevice went wrong");
//     }
// })

getCurrentStatusDataCoap("192.168.107.39").then(data => {
    if (data != null) {
        console.log("pollAirCoapDevice: " + JSON.stringify(data));
        let json = data.status
    } else {
        console.log("pollAirCoapDevice went wrong");
    }
    getCurrentStatusDataCoap("192.168.107.39")
})


