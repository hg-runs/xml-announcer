# XML Announcer
A quick and dirty hack to scan HigherGrounds XML api periodically and forward (run) messages to a discord channel.
## Installation
* Clone repository
* Install needed packages
* Create an .env file with the following content
```
# The bot authorization token
TOKEN=""

# The channel ID to forward the messages to
CHANNEL=""

# The polling interval in milliseconds
INTERVAL_MS=30000
```
## Running
```
node server.js
```

## Polling
The server polls the XML API every 30 seconds. Don't lower this interval. Otherwise it may create to much of a workload.

New message are written to the given channel

## TODO
No idea and no time :)