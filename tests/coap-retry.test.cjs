const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const projectRequire = createRequire(path.resolve('package.json'));

function fixture() {
    let now = 0;
    let sequence = 0;
    const timers = new Map();
    const clock = {
        setTimeout(fn, delay) {
            const id = ++sequence;
            timers.set(id, { fn, at: now + delay });
            return id;
        },
        clearTimeout(id) { timers.delete(id); },
    };
    const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
    const advance = async (ms) => {
        now += ms;
        for (const [id, timer] of [...timers]) {
            if (timer.at <= now) {
                timers.delete(id);
                timer.fn();
            }
        }
        await flush();
    };
    const calls = { sync: 0, control: 0, observe: 0, reset: 0, stop: 0, errors: [] };
    let notification;
    const notifications = new Map();
    const logs = [];
    const coap = {
        reset() { calls.reset++; },
        stopObserving() { calls.stop++; },
        async tryToConnect() { return true; },
        async request(url) {
            if (url.endsWith('/sync')) {
                calls.sync++;
                return { payload: Buffer.from('00000001') };
            }
            calls.control++;
            return { payload: Buffer.from('ok') };
        },
        async observe(url, method, callback) {
            calls.observe++;
            notification = callback;
            notifications.set(url, callback);
        },
    };
    const common = { ...clock, Buffer, console: { log(...args) { logs.push(args.join(' ')); } } };
    const protocolModule = { exports: {} };
    const protocolContext = vm.createContext({
        ...common, module: protocolModule, exports: protocolModule.exports,
        require(name) {
            if (name === 'node-coap-client') return { CoapClient: coap };
            return projectRequire(name);
        },
    });
    vm.runInContext(fs.readFileSync('drivers/philipsairCoap.js', 'utf8'), protocolContext);
    const protocol = protocolModule.exports;
    const airModule = { exports: {} };
    const airContext = vm.createContext({
        ...common, module: airModule, Homey: { Device: class {} },
        require(name) { return name === './philipsairCoap.js' ? protocol : {}; },
    });
    const airSource = fs.readFileSync('drivers/air.js', 'utf8')
        .replace("import Homey from 'homey';", '')
        .replace('export class AirDevice', 'class AirDevice');
    vm.runInContext(airSource + '\nmodule.exports = AirDevice;', airContext);
    const createDevice = (ipkey = '192.168.1.171') => {
        const device = new airModule.exports();
        const settings = { ipkey, add_delay: false };
        device.getSettings = () => settings;
        device.error = (...args) => calls.errors.push(args);
        device.log = () => {};
        device.handleDeviceStatus = () => {};
        return device;
    };
    const device = createDevice();
    const notify = (data, targetDevice) => {
        if (targetDevice) notifications.get('coap://' + targetDevice.getSettings().ipkey + ':5683/sys/dev/status')(data);
        else notification(data);
    };
    return { protocol, device, coap, calls, timers, flush, advance, notify, createDevice, logs };
}

function statusPayload(value = 1) {
    const counter = value.toString(16).toUpperCase().padStart(8, '0');
    const keyAndIv = crypto.createHash('md5').update('JiangPan' + counter).digest('hex').toUpperCase();
    const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(keyAndIv.slice(0, 16)), Buffer.from(keyAndIv.slice(16)));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ state: { reported: { pwr: '1' } } })), cipher.final()]);
    const message = counter + encrypted.toString('hex').toUpperCase();
    return Buffer.from(message + crypto.createHash('sha256').update(message).digest('hex').toUpperCase());
}

test('sync failure rejects, cleans up, and never starts observing', async () => {
    const f = fixture();
    f.coap.request = async () => { throw new Error('Retransmit counter exceeded'); };
    await assert.rejects(f.protocol.getCurrentStatusDataCoap(f.device.getSettings(), f.device), /Retransmit/);
    assert.equal(f.calls.observe, 0);
    assert.equal(f.timers.size, 0);
    assert.ok(f.calls.reset >= 2);
});

test('offline retries back off, cap at five minutes, and reject duplicate starts', async () => {
    const f = fixture();
    f.coap.request = async () => { f.calls.sync++; throw new Error('offline'); };
    const first = f.device.observerAirCoapDevice();
    await f.device.observerAirCoapDevice();
    await first;
    assert.equal(f.calls.sync, 1);
    await f.device.observerAirCoapDevice();
    assert.equal(f.calls.sync, 1);
    for (const delay of [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000]) {
        const before = f.calls.sync;
        await f.advance(delay - 1);
        assert.equal(f.calls.sync, before);
        await f.advance(1);
        assert.equal(f.calls.sync, before + 1);
        assert.equal(f.timers.size, 1);
    }
    f.device.stopAirCoapDevice();
    await f.advance(600000);
    assert.equal(f.timers.size, 0);
});

test('sync must finish before observation; cancellation prevents late observation', async () => {
    const f = fixture();
    let resolveSync;
    f.coap.request = () => new Promise(resolve => { resolveSync = resolve; });
    const pending = f.device.observerAirCoapDevice();
    await f.flush();
    assert.equal(f.calls.observe, 0);
    f.device.stopAirCoapDevice();
    resolveSync({ payload: Buffer.from('00000001') });
    await pending;
    await f.flush();
    assert.equal(f.calls.observe, 0);
    assert.equal(f.timers.size, 0);
});

test('successful observation resets backoff and its completion timer fires only once', async () => {
    const f = fixture();
    f.device.coapRetryCount = 5;
    const pending = f.device.observerAirCoapDevice();
    await f.flush();
    assert.equal(f.calls.observe, 1);
    f.notify({ payload: statusPayload() });
    const completion = f.device.getTimeoutId();
    completion.trigger();
    completion.trigger();
    await pending;
    assert.equal(f.device.coapRetryCount, 0);
    assert.equal(f.timers.size, 1);
    await f.advance(999);
    assert.equal(f.calls.sync, 1);
    await f.advance(1);
    assert.equal(f.calls.sync, 2);
    f.device.stopAirCoapDevice();
    await f.flush();
    assert.equal(f.timers.size, 0);
});

test('observe rejection and invalid notifications reject with timer cleanup', async () => {
    const f = fixture();
    f.coap.observe = async () => { throw new Error('observe failed'); };
    await assert.rejects(f.protocol.getCurrentStatusDataCoap(f.device.getSettings(), f.device), /observe failed/);
    assert.equal(f.timers.size, 0);
    const g = fixture();
    const pending = g.protocol.getCurrentStatusDataCoap(g.device.getSettings(), g.device);
    await g.flush();
    g.notify({ payload: Buffer.from('bad hash') });
    await assert.rejects(pending, /Invalid message hash/);
    assert.equal(g.timers.size, 0);
});

test('failed command sync propagates and never sends control', async () => {
    const f = fixture();
    f.coap.request = async url => {
        if (url.endsWith('/control')) f.calls.control++;
        throw new Error('sync failed');
    };
    await assert.rejects(f.device.setStateCoap('pwr', '1', f.device.getSettings()), /sync failed/);
    assert.equal(f.calls.control, 0);
    assert.equal(f.timers.size, 0);
});

test('commands serialize and observer reconnect waits for all queued commands', async () => {
    const f = fixture();
    const first = f.device.setStateCoap('pwr', '1', f.device.getSettings());
    const second = f.device.setStateCoap('pwr', '0', f.device.getSettings());
    await f.flush();
    assert.equal(f.calls.sync, 1);
    await f.device.observerAirCoapDevice();
    await f.advance(1000);
    assert.equal(f.calls.observe, 0);
    assert.equal(f.calls.reset, 0);
    await f.advance(1000);
    await first;
    assert.equal(f.calls.control, 1);
    assert.equal(f.calls.sync, 2);
    await f.advance(2000);
    await second;
    assert.equal(f.calls.control, 2);
    await f.advance(1000);
    assert.equal(f.calls.observe, 1);
    f.device.stopAirCoapDevice();
    await f.flush();
    assert.equal(f.timers.size, 0);
});

test('cancellation clears the optional startup delay', async () => {
    const f = fixture();
    f.device.getSettings().add_delay = true;
    const pending = f.device.observerAirCoapDevice();
    f.device.stopAirCoapDevice();
    await pending;
    assert.equal(f.timers.size, 0);
    assert.equal(f.calls.sync, 0);
});

test('two purifiers keep independent counters for notifications, commands and reconnects', async () => {
    const f = fixture();
    const bedroom = f.device;
    const kitchen = f.createDevice('192.168.1.172');
    const bedroomObservation = bedroom.observerAirCoapDevice();
    const kitchenObservation = kitchen.observerAirCoapDevice();
    await f.flush();
    for (const [device, counter] of [[bedroom, 17], [kitchen, 2], [bedroom, 18], [kitchen, 3]]) {
        f.notify({ payload: statusPayload(counter) }, device);
    }
    assert.equal(bedroom.coapStatusCounter, 18);
    assert.equal(kitchen.coapStatusCounter, 3);
    assert.equal(f.logs.filter(line => line.includes('Invalid message id')).length, 0);
    const syncRequests = [];
    f.coap.request = async (url, method, payload) => {
        if (url.endsWith('/sync')) syncRequests.push([url, payload.toString()]);
        return { payload: Buffer.from('00000001') };
    };
    const command = kitchen.setStateCoap('aqil', 100, kitchen.getSettings());
    await f.flush();
    await f.advance(2000);
    await command;
    await kitchenObservation;
    assert.deepEqual(syncRequests[0], ['coap://192.168.1.172:5683/sys/dev/sync', '00000003']);
    bedroom.getTimeoutId().trigger();
    await bedroomObservation;
    await f.advance(1000);
    assert.ok(syncRequests.some(([url, payload]) => url.includes('192.168.1.171') && payload === '00000012'));
    assert.ok(syncRequests.some(([url, payload]) => url.includes('192.168.1.172') && payload === '00000003'));
    bedroom.stopAirCoapDevice();
    kitchen.stopAirCoapDevice();
    await f.flush();
    assert.equal(f.timers.size, 0);
});
