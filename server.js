var Version = "0.021", ProjectName = "Interface: HG XML to Discord";


var https = require('https');
var http = require('http');
var xml2js = require('xml2js');
//var parser = new xml2js.Parser();
var parser = new xml2js.Parser({ explicitArray: false });
var request = require("request");
var concat = require('concat-stream');
var fs = require("fs");
var appRoot = require('app-root-path');
var winston = require('winston');
// var auth = require('./auth.json');

const Discord = require('discord.js');

var url = 'http://info.hgweb.org/webout.cgi?type=all&format=xml';

const config_file = "config.json";
const stat_file = "stats.json";

if (process.env.NODE_ENV !== 'production') {
	require('dotenv').config();
}

const token = process.env.TOKEN;
const interval = process.env.INTERVAL_MS
const feedToServe = process.env.FEED

const client = new Discord.Client();


var options = {
	file: {
		level: 'info',
		name: 'file.info',
		filename: `${appRoot}/logs/app.log`,
		handleExceptions: true,
		json: true,
		maxsize: 5242880, // 5MB
		maxFiles: 100,
		colorize: true,
	},
	errorFile: {
		level: 'error',
		name: 'file.error',
		filename: `${appRoot}/logs/error.log`,
		handleExceptions: true,
		json: true,
		maxsize: 5242880, // 5MB
		maxFiles: 100,
		colorize: true,
	},
	console: {
		level: 'debug',
		handleExceptions: true,
		json: false,
		colorize: true,
	},
};

var logger = new winston.createLogger({
	transports: [
		// new (winston.transports.Console)(options.console),
		new (winston.transports.File)(options.errorFile),
		new (winston.transports.File)(options.file)
	],
	exitOnError: false, // do not exit on handled exceptions
});

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

// example of a message item as seen on HD XML web page
//ITEM:  { uid: '1463138558.706707',
//  channel: '-4',
//  type: 'Chat Message',
//  senttime: '2016-05-13T13:04:27Z',
//  server: 'Chat',
//  sender: 'Somebody Artsy',
//  character: 'Somebody Artsy',
//  player: 'Lynslayer',
//  fullmsg: 'Interserver chat message from Somebody Artsy (Lynslayer): They should add a BUR or XUR item in the game that lets you skip the  reincarnation waiting time',
//  text: 'They should add a BUR or XUR item in the game that lets you skip the reincarnation waiting time',
//  title: 'Chat Message: They should add a BUR or XUR item in the game that lets you skip the reincarnation waiting time, from Somebody Artsy  (Lynslayer), sent 2016-05-13 13:04:27' }

function refresh_xml() {

	var request = http.get(url, function (resp) {

		resp.on('error', function (err) {
			logger.error('Error while reading', err);
		});

		resp.pipe(concat(function (buffer) {

			var str = buffer.toString();
			parser.parseString(str, function (err, result) {
				logger.info('Finished parsing at ' + (new Date()).toISOString());

				if (typeof result !== 'undefined') {

					var i, s, len = result.server_data.serverinfo.type.length;
					for (i = 0; i < len; ++i) {
						if (i in result.server_data.serverinfo.type) {
							s = result.server_data.serverinfo.type[i];
							appStats.timestamps[s.name] = new Date(s.updated);
						}
					}
					var j;
					// timestamp changed, check all feeds
					for (j = 0; j < appConfig.feeds.length; ++j) {
						if (appConfig.feeds[j].enabled) {
							if (!(appConfig.feeds[j].name in appStats.last_updated)) {
								// new feed: set date of last update to 0 (start of epoch)
								appStats.last_updated[appConfig.feeds[j].name] = new Date(0);
								statsChanged();
							}
							if (new Date(appStats.timestamps["Messages"]) > new Date(appStats.last_updated[appConfig.feeds[j].name])) {
								i = appConfig.feeds[j].xmlChannelIndex;
								scan_list_for_new_messages(result.server_data.message_list[i], new Date(appStats.last_updated[appConfig.feeds[j].name]), appConfig.feeds[j])
								//appStats.last_updated[appConfig.feeds [j].name] = appStats.timestamps["Messages"];
								appStats.last_updated[appConfig.feeds[j].name] = appStats.timestamps.Messages;
								statsChanged();
							}
						}
					}
				} else {
					logger.error("No server data!");
				}
			});
		}));

	});

	request.on('error', function (err) {
		logger.error((new Date()).toISOString() + ' Error while connecting to: ' + err.address + ":" + err.port + " with code:", err.code);
	});


}

function send_to_discord(messagetext, messageplayer, sender, time, server, channelIDs, color, showServer) {

	const text = messagetext;
	const player = messageplayer;
	// const icon = client.emojis.cache.find(emoji => emoji.name == "HGIcon_Run");

	// client.emojis.cache.forEach(logMapElements);
	// const emojiList = message.guild.emojis.map((e, x) => (x + ' = ' + e) + ' | ' +e.name).join('\n');
	// message.channel.send(emojiList);

	if (showServer) {
		// desc = `${player}:\n**${text}**\n> \`\`\`yaml\n*Server: ${server}*\n\`\`\``
		desc = `${sender}(${player}):\n**${text}**\n> \t*Server: ${server}*`
	} else {
		desc = `${sender}(${player}):\n**${text}**`
	}

	const embed = {
		// "title": `${icon} detected a *run* message:`,
		// "title": `${player}:`,
		"description": desc,
		// "url": "https://discordapp.com",
		// "color": 0xe044e0,
		"color": color,
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
		// 	"icon_url": "attachment://discordjs.png"
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
		// image: {
		// 	url: 'attachment://discordjs.png',
		// },
	};

	// var file = new Discord.MessageAttachment('./assets/discordjs.png');
	for (c in channelIDs) {
		// console.log(c)
		// console.log(channelIDs[c])
		var channel = client.channels.cache.get(channelIDs[c]);
		logger.info(embed);
		channel.send({ embed });
		// channel.send({ files: [file], embed: embed });
	}
}

// REVIEW: Are message still not displayed in order by discord?
function scan_list_for_new_messages(list, date_stamp, feed) {
	var i, s, len = list.message.length;
	logger.info('# of items: ' + list.message.length);
	logger.info('timestamp used: ' + date_stamp);
	logger.info('feed: ' + feed.name);

	var list_as_array = Array.prototype.slice.call(list.message);

	// the list is sorted, idx 0 is latest, traversing array in reverse to send oldest as first message
	// sort list by date, list is max 50 items, in case you need another sort order
	list_as_array.sort(function (a, b) {
		var c = new Date(a.senttime);
		var d = new Date(b.senttime);
		return d - c;
	});

	// Find index of first message already seen
	var index = -1;
	for (i = 0; i < len; ++i) {
		if (new Date(list_as_array[i].senttime) <= new Date(date_stamp)) {
			index = i;
			break;
		}
		if (i + 1 == len) {
			index = len;
		}
	}

	if (index > 0) {
		// index points to the last already seen element + 1
		for (i = index; i-- > 0;) {
			if (i in list_as_array) {
				s = list_as_array[i];
				if (new Date(s.senttime) > new Date(date_stamp)) {
					sendItem(s, feed);
					logger.info("Send: " + s.channel + " - " + s.type + " / " + s.senttime + " - " + s.sender + ": " + s.text);
				}
			}
		}
	}
}

function sendItem(item, feed) {
	if (appConfig.flPostingEnabled) {
		logger.info(feed.name + ": " + item.text);
		logger.info("FeedToServe:" + feedToServe);

		//TODO: implement switch Discord/Slack
		// if (feed.slack !== undefined) {
		// 	if (item.text !== undefined) {
		// 		var s = item.text;
		// 		if (item.link !== undefined) {
		// 			s += ". <" + item.link + "|" + slackLinkText + ">";
		// 		}
		// 		if (feed.name === feedToServe) {
		// 			send_to_discord(s, item.player, item.sender, item.senttime, item.server);
		// 		}
		// 	}
		// }
		if (feed.discord !== undefined) {
			if (feed.enabled) {
				send_to_discord(item.text, item.player, item.sender, item.senttime, item.server, feed.discord.channelIDs, feed.discord.color, feed.name === "run");
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
			logger.error("Error reading stats.json:" + jsonStringify(err));
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
			return logger.error(err);
		}
	});
	//fs.writeFile ("stats.json", jsonStringify (appStats));
}


function readConfig(callback) {
	fs.readFile(config_file, "utf8", function (err, data) {
		var dataAboutRead = {
			Body: data
		};
		if (err) {
			logger.error("readConfig: error == " + jsonStringify(err));
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

	// // Send the message to a designated channel on a server:
	// const channel = member.guild.channels.find('name', 'member-log');
	// // Do nothing if the channel wasn't found on this server
	// if (!channel) return;
	// // Send the message, mentioning the member
	// channel.send(`Welcome to the server, ${member}`);

});

client.on("guildCreate", guild => {
	// This event triggers when the bot joins a guild.
	logger.info(`New guild joined: ${guild.name} (id: ${guild.id}). This guild has ${guild.memberCount} members!`);
});

client.on("guildDelete", guild => {
	// this event triggers when the bot is removed from a guild.
	logger.info(`I have been removed from: ${guild.name} (id: ${guild.id})`);
});

function logMapElements(value, key, map) {
	logger.debug(`m[${key}] = ${value}`);
}

client.on("ready", () => {
	// client.emojis.cache.forEach(logMapElements);

	// send_to_discord("Starting service", "Bot status message", "bot", new Date().toISOString().split('.')[0] + "Z", 311, "426339936044843018", "#6087FF", false);
	// send_to_discord("Starting service", "Bot status message", "bot", new Date().toISOString().split('.')[0] + "Z", 311, "760230386223022120", "#6087FF", false);
	// send_to_discord("Starting service", "Bot status message", "HG-Announcer", new Date().toISOString().split('.')[0] + "Z", 311, ["426339936044843018", "760230386223022120"], "#6087FF", false);

	logger.info('Connected');
	logger.info(`Hosting ${client.users.cache.size} users, in ${client.channels.cache.size} channels of ${client.guilds.cache.size} guilds.`);

	// client.user.setPresence({ activity: { name: `${client.guilds.cache.size} server`, type: 'WATCHING' }, status: 'online' })
	// 	.then(logger.info)
	// 	.catch(logger.error);
});

client.login(token);

process.on('unhandledRejection', error => logger.error(`Uncaught Promise Rejection:\n${error}`));

parser.on('error', function (err) { logger.error('Parser error', err); });

readConfig(function () {
	readStats(function () {
		logger.info("\n" + ProjectName + " v" + Version + ".");
		refresh_xml();
		setInterval(refresh_xml, interval);
		setInterval(everySecond, 1000);
	});
});
