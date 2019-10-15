// imports
const mc = require('minecraft-protocol'); // to handle minecraft login session
const webserver = require('./webserver.js'); // to serve the webserver
const opn = require('opn'); //to open a browser window
const secrets = require('./secrets.json'); // read the creds
const config = require('./config.json'); // read the config

webserver.createServer(config.ports.web); // create the webserver
webserver.password = config.password
webserver.onstart(() => { // set up actions for the webserver
	startQueuing();
});
webserver.onstop(() => {
	stop();
});

if (config.openBrowserOnStart) {
    opn('http://localhost:' + config.ports.web); //open a browser window
}


// lets
let proxyClient; // a reference to the client that is the actual minecraft game
let client; // the client to connect to 2b2t
let server; // the minecraft server to pass packets

// function to disconnect from the server
function stop(){
	webserver.isInQueue = false;
	webserver.queuePlace = "None";
	webserver.ETA = "None";
	if (proxyClient) {
		proxyClient.end("Stopped the proxy."); // boot the player from the server
	}
	client.end(); // disconnect
	server.close(); // close the server
}

// function to start the whole thing
function startQueuing() {
	webserver.isInQueue = true;
	client = mc.createClient({ // connect to 2b2t
		host: "2b2t.org",
		port: 25565,
		username: secrets.username,
		password: secrets.password,
		version: config.MCversion
	});
	let finishedQueue = false;
	let packetMetaArr = [];
	let packetDataArr = [];
	let packetExceptions = ["encryption_begin", "compress", "custom_payload", "success", "chat", "compress", "playerlist_header", "keep_alive", "update_time"];
	let firstPackets = true
	client.on("packet", (data, meta) => { // each time 2b2t sends a packet
		if (!finishedQueue && meta.name === "playerlist_header") { // if the packet contains the player list, we can use it to see our place in the queue
			let headermessage = JSON.parse(data.header);
			let ETA = headermessage.text.split("\n")[6].substring(27);
			webserver.ETA = ETA;
			
			let positioninqueue = headermessage.text.split("\n")[5].substring(25);
			webserver.queuePlace = positioninqueue; // update info on the web page
			positioninqueue = parseInt(positioninqueue, 10);
			if (positioninqueue >= 300) {
				server.motd = `§6§lPlace in queue: §c${positioninqueue}`;
			} else if (positioninqueue >= 200) {
				server.motd = `§6§lPlace in queue: §e${positioninqueue}`;
			} else if (positioninqueue >= 100) {
				server.motd = `§6§lPlace in queue: §a${positioninqueue}`;
			} else if (positioninqueue < 100) {
				server.motd = `§6§lPlace in queue: §2${positioninqueue}`;
			} else {
				server.motd = `§6§lPlace in queue: §6None`;
			}
		}
		
		if (!finishedQueue && firstPackets && !(packetExceptions.indexOf(meta.name) > -1)) {
			packetMetaArr.push(meta)
			packetDataArr.push(data)
		}
		
		if (meta.name === "update_time" && firstPackets) {
			firstPackets = false;
		
			for (i = 0; i < packetMetaArr.length; i++) {
				if (packetMetaArr[i].name != "map_chunk") {
					console.log(`Meta: ${packetMetaArr[i].name}, Data: ${JSON.stringify(packetDataArr[i])}`);
				}
			}
		}
		
		if (finishedQueue === false && meta.name === "chat") { // we can know if we're about to finish the queue by reading the chat message
			// we need to know if we finished the queue otherwise we crash when we're done, because the queue info is no longer in packets the server sends us.
			let chatMessage = JSON.parse(data.message);
			if (chatMessage.text && chatMessage.text === "Connecting to the server...") {
                if (webserver.restartQueue && proxyClient == null) { //if we have no client connected and we should restart
                    stop();
                    setTimeout(startQueuing, 100); // reconnect after 100 ms
                } else {
                    finishedQueue = true;
                    webserver.queuePlace = "FINISHED";
                    webserver.ETA = "NOW";  
                }
			}
		}

		if (proxyClient) { // if we are connected to the proxy, forward the packet we recieved to our game.
			filterPacketAndSend(data, meta, proxyClient);
		}
	});

	// set up actions in case we get disconnected.
	client.on('end', () => {
		if (proxyClient) {
            proxyClient.end("Connection reset by 2b2t server.");
            proxyClient = null
		}
		stop();
		//setTimeout(startQueuing, 100); // reconnect after 100 ms
	});

	client.on('error', (err) => {
		if (proxyClient) {
            proxyClient.end(`Connection error by 2b2t server.\n Error message: ${err}\nReconnecting...`);
            proxyClient = null
		}
		console.log('err', err);
		stop();
		setTimeout(startQueuing, 100); // reconnect after 100 ms
	});

	server = mc.createServer({ // create a server for us to connect to
		'online-mode': false,
		encryption: true,
		host: '0.0.0.0',
		port: config.ports.minecraft,
		version: config.MCversion,
		'max-players': maxPlayers = 1
	});

	server.on('login', (newProxyClient) => { // handle login
		for (i = 0; i < packetMetaArr.length; i++) {
			filterPacketAndSend(packetDataArr[i], packetMetaArr[i], newProxyClient);
			sleep(2);
		}
		
		newProxyClient.on('packet', (data, meta) => { // redirect everything we do to 2b2t
			filterPacketAndSend(data, meta, client);
		});

		proxyClient = newProxyClient;
	});
}

//function to filter out some packets that would make us disconnect otherwise.
//this is where you could filter out packets with sign data to prevent chunk bans.
function filterPacketAndSend(data, meta, dest) {
	if (meta.name != "keep_alive" && meta.name != "update_time") { //keep alive packets are handled by the client we created, so if we were to forward them, the minecraft client would respond too and the server would kick us for responding twice.
		dest.write(meta.name, data);
	}
}

function sleep(milliseconds) {
  var start = new Date().getTime();
  for (var i = 0; i < 1e7; i++) {
    if ((new Date().getTime() - start) > milliseconds){
      break;
    }
  }
}
