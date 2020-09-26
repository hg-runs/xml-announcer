var Version = "0.021", ProjectName = "Interface: HG XML to Discord";


var https = require('https');
var http = require('http');
var xml2js = require('xml2js');
//var parser = new xml2js.Parser();
var parser = new xml2js.Parser({ explicitArray: false });
var request = require("request");
var concat = require('concat-stream');
var fs = require("fs");

const Discord = require('discord.js');

var url = 'http://info.hgweb.org/webout.cgi?type=all&format=xml';

const config_file = "config.json";
const stat_file = "stats.json";

if (process.env.NODE_ENV !== 'production') {
	require('dotenv').config();
}
  
const token = process.env.TOKEN;
const channelID = process.env.CHANNEL

const channelNWNHigherGroundsRuns = "285255258622394369"
const channelNWNHigherGroundsTrade = "751457838345486406"

const client = new Discord.Client();

var appConfig;
var appStats = {
	ctStarts: 0, whenLastStart: new Date(0),
	ctReadErrors: 0, ctReads: 0, ctBytesRead: 0,
	timestamps: {},
	last_updated: {},
	messages_last_update: new Date(0),
	feeds: new Object()
};
var flStatsChanged = false;

function jsonStringify(jstruct) {
	return (JSON.stringify(jstruct, undefined, 4));
}


parser.on('error', function (err) { console.log('Parser error', err); });

function refresh_xml() {

	var request = http.get(url, function (resp) {

		resp.on('error', function (err) {
			console.log('Error while reading', err);
		});

		resp.pipe(concat(function (buffer) {

			var str = buffer.toString();
			parser.parseString(str, function (err, result) {
				console.log('Finished parsing at ' + (new Date()).toISOString());
				//console.log('Finished parsing:', err, result);

				if (typeof result !== 'undefined') {

					var i, s, len = result.server_data.serverinfo.type.length;
					for (i = 0; i < len; ++i) {
						if (i in result.server_data.serverinfo.type) {
							s = result.server_data.serverinfo.type[i];
							appStats.timestamps[s.name] = new Date(s.updated);
						}
					}
					//console.log("   Serverinfo - timestamp last update for messages: ", appStats.timestamps["Messages"]);
					var j;
					// timestamp changed, check all feeds
					for (j = 0; j < appConfig.feeds.length; ++j) {
						if (appConfig.feeds[j].enabled) {
							//console.log("Processing channel: " + appConfig.feeds [j].name);
							if (!(appConfig.feeds[j].name in appStats.last_updated)) {
								// new feed: set date of last update to 0 (start of epoch)
								appStats.last_updated[appConfig.feeds[j].name] = new Date(0);
								statsChanged();
							}
							if (new Date(appStats.timestamps["Messages"]) > new Date(appStats.last_updated[appConfig.feeds[j].name])) {
								//console.log ("Last update: " + appStats.last_updated[appConfig.feeds [j].name]);
								//console.log ("New update timestamp: " + appStats.timestamps["Messages"]);
								i = appConfig.feeds[j].xmlChannelIndex;
								scan_list_for_new_messages(result.server_data.message_list[i], new Date(appStats.last_updated[appConfig.feeds[j].name]), appConfig.feeds[j])
								//appStats.last_updated[appConfig.feeds [j].name] = appStats.timestamps["Messages"];
								appStats.last_updated[appConfig.feeds[j].name] = appStats.timestamps.Messages;
								statsChanged();
							}
						}
					}
				} else {
					console.log("No server data!");
				}
			});
		}));

	});

	request.on('error', function (err) {
		console.log((new Date()).toISOString() + ' Error while connecting to: ' + err.address + ":" + err.port + " with code:", err.code);
	});


}

function send_to_discord(messagetext, messageplayer, sender, time) {

	const text = messagetext;
	const player = messageplayer;
	const icon = client.emojis.cache.find(emoji => emoji.name == "HGIcon_Run");

	// client.emojis.cache.forEach(logMapElements);
	// console.log('Icon found: ' + icon);

	// const emojiList = message.guild.emojis.map((e, x) => (x + ' = ' + e) + ' | ' +e.name).join('\n');
	// message.channel.send(emojiList);

	const embed = {
		// "title": `${icon} detected a *run* message:`,
		// "title": `${player}:`,
		"description": `${player}:\n**${text}**`,
		// "url": "https://discordapp.com",
		"color": 0xe044e0,
		// "timestamp": "2018-03-30T08:55:50.533Z",
		// "timestamp": time,
		"footer": {
			// "icon_url": "https://cdn.discordapp.com/embed/avatars/0.png",
			icon_url: client.user.avatarURL(),
			"text": `Ingame timestamp: ${time}`
		},
		// "thumbnail": {
		// 	"url": "https://cdn.discordapp.com/embed/avatars/0.png"
		// },
		// "author": {
		// 	"name": "HG XML reader",
		// 	"url": "https://discordapp.com",
		// 	"icon_url": "https://cdn.discordapp.com/embed/avatars/0.png"
		// },
		// "fields": [
			// {
			// 	"name": "Sender:",
			// 	"value": player,
			// 	// "inline": true
			// 	"inline": false
			// },
			// {
			// 	"name": "Ingame timestamp:",
			// 	"value": `Ingame timestamp: **${time}**`,
			// 	"inline": true
			// }
		// ]
	};

	var channel = client.channels.cache.get(channelID);
	console.log(embed);
	// channel.send({ embed });
}

// REVIEW: Are message still not displayed in order by discord?
function scan_list_for_new_messages(list, date_stamp, feed) {
	var i, s, len = list.message.length;
	//console.log('# of items: ' + list.message.length);
	console.log('timestamp used: ' + date_stamp);
	console.log('feed: ' + feed.name);

	var list_as_array = Array.prototype.slice.call(list.message);

	//console.log(list);
	//console.log(list_as_array);
	// the list is sorted, idx 0 is latest, traversing array in reverse to send oldest as first message
	// sort list by date, list is max 50 items, in case you need another sort order
	list_as_array.sort(function (a, b) {
		var c = new Date(a.senttime);
		var d = new Date(b.senttime);
		return d - c;
		//return c-d;
	});
	//console.log(list_as_array);
	//console.log(list_as_array[0]);
	//console.log("Length: " + len);

	// Find index of first message already seen
	var index = -1;
	for (i = 0; i < len; ++i) {
		//console.log("Sort: " + list_as_array[i].senttime);
		//		if  (new Date(list_as_array.message[i].senttime) <= new Date(date_stamp)) {
		if (new Date(list_as_array[i].senttime) <= new Date(date_stamp)) {
			index = i;
			break;
		}
		if (i + 1 == len) {
			index = len;
		}
	}

	//console.log(index);
	if (index > 0) {
		// index points to the last already seen element + 1
		for (i = index; i-- > 0;) {
			//			if (i in list.message) {
			//				s = list.message[i];
			if (i in list_as_array) {
				s = list_as_array[i];
				//console.log(s.channel + " - " + s.senttime + " - " + s.sender + ": " + s.text);
				if (new Date(s.senttime) > new Date(date_stamp)) {
					sendItem(s, feed);
					console.log("Send: " + s.channel + " - " + s.type + " / " + s.senttime + " - " + s.sender + ": " + s.text);
				}
			}
		}
	}
}

function sendItem(item, feed) {
	if (appConfig.flPostingEnabled) {
		console.log(feed.name + ": " + item.text);
		if (feed.slack !== undefined) {
			if (item.text !== undefined) {
				var s = item.text;
				if (item.link !== undefined) {
					s += ". <" + item.link + "|" + slackLinkText + ">";
				}
				send_to_discord(s, item.player, item.sender, item.senttime);
			}
		}
	}
}

function readStats(callback) {
	fs.readFile(stat_file, "utf8", function (err, data) {
		var dataAboutRead = {
			Body: data
		};
		if (err) {
			console.log("Error reading stats.json:" + jsonStringify(err));
		}
		else {
			var storedPrefs = JSON.parse(dataAboutRead.Body);
			for (var x in storedPrefs) {
				appStats[x] = storedPrefs[x];
			}
			appStats.ctReads++;
			appStats.ctBytesRead += dataAboutRead.Body.length;
			statsChanged();
		}
		if (callback !== undefined) {
			callback();
		}
	});
}

function writeStats() {
	fs.writeFile(stat_file, jsonStringify(appStats), function (err) {
		if (err) {
			return console.log(err);
		}
		//console.log("Debug output: File saved");
	});
	//fs.writeFile ("stats.json", jsonStringify (appStats));
}


function readConfig(callback) {
	// Using temporay an absolute path
	//fs.readFile ("config.json", "utf8", function (err, data) {
	fs.readFile(config_file, "utf8", function (err, data) {
		var dataAboutRead = {
			Body: data
		};
		if (err) {
			console.log("readConfig: error == " + jsonStringify(err));
		}
		else {
			appConfig = JSON.parse(dataAboutRead.Body);
			appStats.ctReads++;
			appStats.ctBytesRead += dataAboutRead.Body.length;
			statsChanged();
		}
		if (callback !== undefined) {
			callback();
		}
	});
}

function statsChanged() {
	flStatsChanged = true;
}

function everySecond() {
	if (flStatsChanged) {
		flStatsChanged = false;
		writeStats();
	}
}

// Create an event listener for new guild members
client.on('guildMemberAdd', member => {
	// Send the message to a designated channel on a server:
	const channel = member.guild.channels.find('name', 'member-log');
	// Do nothing if the channel wasn't found on this server
	if (!channel) return;
	// Send the message, mentioning the member
	channel.send(`Welcome to the server, ${member}`);
});

client.on("guildCreate", guild => {
	// This event triggers when the bot joins a guild.
	console.log(`New guild joined: ${guild.name} (id: ${guild.id}). This guild has ${guild.memberCount} members!`);
	client.user.setGame(`on ${client.guilds.size} servers`);
});

client.on("guildDelete", guild => {
	// this event triggers when the bot is removed from a guild.
	console.log(`I have been removed from: ${guild.name} (id: ${guild.id})`);
	client.user.setGame(`on ${client.guilds.size} servers`);
});

function logMapElements(value, key, map) {
	console.log(`m[${key}] = ${value}`);
}

client.on("ready", () => {
	client.emojis.cache.forEach(logMapElements);
	send_to_discord("Starting service", "Bot", "bot", new Date().toISOString().split('.')[0]+"Z" );
});

client.login(token);

process.on('unhandledRejection', error => console.error(`Uncaught Promise Rejection:\n${error}`));

readConfig(function () {
	readStats(function () {
		console.log("\n" + ProjectName + " v" + Version + ".");
		refresh_xml();
		setInterval(refresh_xml, 30000);
		//		setInterval (refresh_xml, 5000);
		setInterval(everySecond, 1000);
	});
});
