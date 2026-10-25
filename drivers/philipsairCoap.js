(function () {

    let philipsairCoap = exports;

    const coapclass = require("node-coap-client");
    const origin = require('node-coap-client/build/lib/Origin');
    const crypto = require('crypto');
    let aesjs = require('aes-js');
    let pkcs7 = require('pkcs7');

    let sharedKey = 'JiangPan';


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
        let aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
        let decryptedBytes = aesCbc.decrypt(data);
        return decryptedBytes;
    }

    function aes_encrypt2(data, key, iv) {
        let aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
        let encryptedBytes = aesCbc.encrypt(data);
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
        // data = data.replace(/[\u0000-\u0019]+/g, "");
        // return JSON.parse(data);
        try {
            data = data.replace(/[\u0000-\u0019]+/g, "");
            return JSON.parse(data);
        } catch {
            console.log('error', `Cannot parse: ${data}`);
            throw new Error('Cannot parse: ' + data);
        }
    }

    // active functions()  -------------------------------------  active functions()  --------------------------------------------

    philipsairCoap.getCurrentStatusDataCoap = function getCurrentStatusDataCoap(settings, device) {
        return new Promise((resolve, reject) => {
            getCurrentDataCoap(settings, device, (error, jsonobj) => {
                if (error) reject(error);
                else resolve(jsonobj);
            }).catch(reject);
        });
    }

    philipsairCoap.setValueAirDataCoap = function setValueAirDataCoap(key, value, settings, device) {
        return setValueDataCoap(key, value, settings, device);
    }

    // sleep time expects milliseconds
    function sleep(time) {
        return new Promise((resolve) => setTimeout(resolve, time));
    }

    let newTimeout = (handler, delay) => {
        let active = true;
        let id;
        const clear = () => {
            active = false;
            clearTimeout(id);
        };
        const trigger = () => {
            if (!active) return;
            clear();
            handler();
        };
        id = setTimeout(trigger, delay);
        return { id, clear, trigger };
    };

    async function getCurrentDataCoap(settings, device, callback) {
        let statusCounter = device.coapStatusCounter || 0;
        const target = new origin.Origin('coap:', settings.ipkey, 5683);
        const targetString = 'coap://' + settings.ipkey + ':5683';
        const coap = device.getClient() || coapclass.CoapClient;
        device.setClient(coap);
        let jsonStatus = null;
        let finished = false;
        let delayId;
        let resumeDelay;
        const finish = (error) => {
            if (finished) return;
            finished = true;
            timeoutId.clear();
            clearTimeout(delayId);
            if (resumeDelay) resumeDelay();
            coap.stopObserving(targetString + '/sys/dev/status');
            // Discard failed requests so the next attempt cannot reuse a rejected promise.
            if (error) coap.reset(target);
            callback(error, error ? null : { status: jsonStatus });
        };
        const timeoutId = newTimeout(() => {
            finish(jsonStatus === null ? new Error('No response received') : null);
        }, 600000);
        timeoutId.cancel = () => {
            finish(null);
            coap.reset(target);
        };
        device.setTimeoutId(timeoutId);

        try {
            if (settings.add_delay === true) {
                await new Promise(resolve => {
                    resumeDelay = resolve;
                    delayId = setTimeout(resolve, 60000);
                });
            }
            if (finished) return;
            coap.reset(target);
            const connectResult = await coap.tryToConnect(target);
            if (finished) return;
            if (connectResult !== true) throw new Error('CoAP connection failed: ' + connectResult);
            const response = await coap.request(targetString + '/sys/dev/sync', 'post',
                Buffer.from(encodeCounter(statusCounter, 8)), { keepAlive: true });
            if (finished) return;
            if (!response || !response.payload || !response.payload.length) {
                throw new Error('No response received for sync call: ' + targetString);
            }

            await coap.observe(targetString + '/sys/dev/status', 'get', resp => {
                if (finished) return;
                try {
                    if (resp.payload) {
                        const response = resp.payload.toString('utf-8');
                        const encodedCounter = response.substring(0, 8);
                        let counter = decodeCounter(encodedCounter);
                        console.log("counter " + counter);
                        const hash = response.substring(response.length - 64);
                        const encodedMessageAndCounter = response.substring(0, response.length - 64);

                        // console.log(encodedMessageAndCounter);
                        const hashedMessage = Buffer.from(toSha256(encodedMessageAndCounter)).toString('hex').toUpperCase();
                        console.log("statusCounter " + statusCounter);
                        if (counter < 1 || counter > 2000000000 ||
                            (statusCounter !== 0 && ((counter < statusCounter && statusCounter < 2000000000 - 10) ||
                                ((counter > statusCounter + 10 && counter < 2000000000) ||
                                    (2000000000 - statusCounter < 10 && counter < statusCounter &&
                                        (10 - (2000000000 - statusCounter)) + 1 < counter && counter < statusCounter))))) {
                            console.log('Invalid message id');
                            // throw new Error('Invalid message id');
                        }
                        if (hash !== hashedMessage) {
                            console.log('Invalid message hash');
                            throw new Error('Invalid message hash');
                        }
                        if (counter >= 2000000000) {
                            counter = 1;
                        }

                        statusCounter = counter;
                        device.coapStatusCounter = counter;

                        let keyAndIv = toMD5(sharedKey + encodedCounter).toString('hex').toUpperCase();
                        // console.log("keyAndIv " + keyAndIv);
                        const secretKey = keyAndIv.substring(0, keyAndIv.length / 2);
                        // console.log("secret " + secretKey);
                        const iv = keyAndIv.substring(keyAndIv.length / 2, keyAndIv.length);
                        // console.log("iv " + iv);

                        const encodedMessage = response.substring(8, response.length - 64);
                        if (encodedMessage.length % 16 !== 0) {
                            console.log("Encoded message length is not a multiple of 16 bytes:", encodedMessage.length);
                            throw new Error('Message corrupted 2: ' + encodedMessage.length);
                        }

                        let payload = new Buffer.from(encodedMessage, 'hex');
                        console.log("Payload length:", payload.length);
                        if (payload.length % 16 !== 0) {
                            console.log("Payload length is not a multiple of 16 bytes:", payload.length);
                            //throw new Error('Message corrupted 3: ' + payload.length);
                        } else {
                            let data = aes_decrypt2(payload, Buffer.from(secretKey, 'utf-8'), Buffer.from(iv, 'utf-8'));
                            let dataText = aesjs.utils.utf8.fromBytes(data);

                            try {
                                jsonStatus = clean(dataText).state.reported;
                                console.log(jsonStatus);
                                device.handleDeviceStatus(jsonStatus, settings);
                            } catch {
                                // ignore, not valid json
                            }
                        }

                    }

                } catch (error) {
                    finish(error);
                }
            }, undefined, {
                confirmable: false, // we expect no answer here in the typical coap way.
                retransmit: false
            });
        } catch (error) {
            finish(error);
        }
    }

    async function setValueDataCoap(key, value, settings, device) {
        const target = new origin.Origin('coap:', settings.ipkey, 5683);
        const targetString = 'coap://' + settings.ipkey + ':5683';
        const coap = device.getClient() || coapclass.CoapClient;
        const observation = device.getTimeoutId();
        try {
            coap.stopObserving(targetString + '/sys/dev/status');
            const connectResult = await coap.tryToConnect(target);
            if (connectResult !== true) throw new Error('CoAP connection failed: ' + connectResult);
            const syncResponse = await coap.request(targetString + '/sys/dev/sync', 'post',
                Buffer.from(encodeCounter(device.coapStatusCounter || 0, 8)), { keepAlive: false });
            if (!syncResponse || !syncResponse.payload || !syncResponse.payload.length) {
                throw new Error('No response received for sync call: ' + targetString);
            }
            let controlCounter = decodeCounter(syncResponse.payload.toString('utf-8'));
            await sleep(2000);
            if (device.coapStopped) throw new Error('Device has been deleted');

            let message = {
                state: {
                    desired: {
                        CommandType: 'app',
                        DeviceId: '',
                        EnduserId: '1'
                    }
                }
            };

            (message.state.desired)[key] = value;
            const messageString = JSON.stringify(message);
            console.log('messageString ' + messageString);

            if (controlCounter == 2000000000) {
                controlCounter = 1;
            } else {
                controlCounter = controlCounter + 1;
            }

            let encodedCounter = encodeCounter(controlCounter, 8);
            let keyAndIv = toMD5(sharedKey + encodedCounter).toString('hex').toUpperCase();

            const secretKey = keyAndIv.substring(0, keyAndIv.length / 2);
            const iv = keyAndIv.substring(keyAndIv.length / 2, keyAndIv.length);

            let dataBytes = pkcs7.pad(aesjs.utils.utf8.toBytes(messageString));
            const encodedMessage = Buffer.from(aes_encrypt2(dataBytes, Buffer.from(secretKey, 'utf-8'), Buffer.from(iv, 'utf-8'))).toString('hex').toUpperCase();
            // console.log('encodedMessage '+encodedMessage);
            let result = encodedCounter + encodedMessage;

            const hash = Buffer.from(toSha256(result)).toString('hex').toUpperCase();

            result = encodedCounter + encodedMessage + hash;
            const response = await coap.request(targetString + '/sys/dev/control', 'post',
                Buffer.from(result), { keepAlive: false });
            if (!response || !response.payload || !response.payload.length) {
                throw new Error('No response received for control call: ' + targetString);
            }
            return { status: response.payload.toString('utf-8') };
        } catch (error) {
            coap.reset(target);
            throw error;
        } finally {
            // Complete only the observation interrupted by this command, once.
            if (observation) observation.trigger();
        }
    }
})();
