# Philips Air purifier

Added support for Philip AIR purifiers, it should work for all the philips air devices but we tested it on 
- AC5659/10 air purifier 
- AC3259/10 air purifier 
- AC3829/10 Humidifier and air purifier 

## Device
For adding the device you need to provide Philips device ip address plus Homey has to be on the same network as your purifier. 

When there is a powerloss or the purifier was restarted then also the device need to be re-added in the homey app, this is because the shared key between the purifier and homey is added only once.

### Actions
- light_intensity, Light level ring 
- button_lights, Display enabled
- purifier_mode, Purifier mode

### Sensors
- latest_retrieval_date
- measure_pm25
- measure_iaql
- measure_tvoc
- measure_humidity
- measure_temperature
- pre_filter_clean
- carbon_filter_replace
- herpa_filter_replace
- product

## Flows

### triggers
- measure_pm25_changed
- measure_iaql_changed
- measure_tvoc_changed

### conditions
- score_pm25 with good, fair, poor and verypoor
- score_iaql (allergen) with good, fair, poor and verypoor

## Thanks
Special thanks to Radoslav Gerganov for reverse enginering and security work. 
For more info see the following links
- https://xakcop.com/post/ctrl-air-purifier/ 
- https://github.com/rgerganov/py-air-control
