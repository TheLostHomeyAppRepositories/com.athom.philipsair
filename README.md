# Philips Air purifier

Added support for Philip AIR purifiers, it should work for all the philips air devices (also the new 2020 devices with COAP protocol) 
Verified on 
- AC3259/10 Air purifier 2019 model
- AC3829/10 Humidifier and air purifier 2019 model
- AC2889/10 Air purifier 2020 model
- AC4236/10 purifier model
- AC0850/11 Air purifier

## Purifier ( + Humidifier) Device
For adding the device you need to provide Philips device ip address plus Homey has to be on the same network as your purifier. 

When there is a powerloss or the purifier was restarted then also the device need to be re-added in the homey app, this is because the shared key between the purifier and homey is added only once.

## Refresh trigger
Every 2 minutes this app will poll for the latest purifer status.

### Actions
- onoff, Power
- light_intensity, Light level ring 
- button_lights, Display enabled
- purifier_mode, Purifier mode
- display_mode, Display mode
- child_lock, Child lock
- fan_speed, Fan speed
- target_humidity ( 40,50,60 0r -- only Humidifier)
- func_mode ( purifier or both -- only Humidifier)

### Sensors
- latest_retrieval_date
- measure_pm25
- measure_iaql
- measure_tvoc
- measure_humidity ( only Humidifier)
- measure_temperature ( only Humidifier)
- water_level ( only Humidifier)
- pre_filter_clean
- carbon_filter_replace
- herpa_filter_replace
- product

## Flows

### triggers
- measure_pm25_changed
- measure_iaql_changed
- measure_tvoc_changed
- measure_humidity_changed ( only Humidifier)
- filter_replace_clean ( 1 hour timeout )

### conditions
- score_pm25 with good, fair, poor and verypoor
- score_iaql (allergen) with good, fair, poor and verypoor

### actions
- on
- off
- purifier_mode
- fan_speed


## Thanks
Special thanks to Radoslav Gerganov for reverse enginering and security work. 
For more info see the following links
- https://xakcop.com/post/ctrl-air-purifier/ 
- https://github.com/rgerganov/py-air-control
- https://github.com/betaboon/philips-airpurifier-coap


## Testing
node test6.js
DEBUG=node-coap-client node testCoap.js