// Dependencies.
var dgram = require('dgram');
var express = require("express");
const { exec } = require('child_process');

////////////////////////////////////////////////////////////////////////////////
// Killing process groups (used to stop cluon-OD4toStdout.
var psTree = require('ps-tree');

var kill = function (pid) {
    signal   = 'SIGKILL';
    if (process.platform !== 'win32') {
        psTree(pid, function (err, children) {
            [pid].concat(
                children.map(function (p) {
                    return p.PID;
                })
            ).forEach(function (tpid) {
                try { process.kill(tpid, signal) }
                catch (e) {}
            });
        });
    }
};

////////////////////////////////////////////////////////////////////////////////
// Web server.
var app = express();
var path = require('path');

// Landing page.
app.get("/", function(req, res) {
    res.sendFile(path.join(__dirname + '/index.html'));
});

// Other static files.
app.get(/^(.+)$/, function(req, res){ 
    res.sendFile(path.join(__dirname + '/' + req.params[0]));
});

// Start server.
var port = process.env.PORT || 8081;
var server = app.listen(port, function () {
    console.log('Listening on port: ' + port);
})

////////////////////////////////////////////////////////////////////////////////
// Websocket stuff.
var record;
const WebSocket = require('ws').Server;
const ws = new WebSocket({server});
ws.on('connection', function connection(ws) {
    ws.on('message', function(msg) {
        if ( (msg[0] == '{') && (msg[msg.length-1] == '}') ) {
            var data = JSON.parse(msg);
            if (data.record) {
                record = exec('cluon-OD4toStdout --cid=111 > /opt/recordings/`date +CID-111-recording-%Y-%m-%d_%H%M%S.rec`');
                console.log('Started cluon-OD4toStdout, PID: ' + record.pid);
            }
            else {
                kill(record.pid);
                console.log('Stopped cluon-OD4toStdout, PID: ' + record.pid);
            }
        }
    });
});

////////////////////////////////////////////////////////////////////////////////
// Connect to OD4Session to broadcast messages to connected websocket clients.
var OD4SESSION_CID = process.env.OD4SESSION_CID || 111;

var client = dgram.createSocket({reuseAddr:true, type:'udp4'}); 
client.bind(12175 /*OD4Session UDP multicast port. */);
client.on('listening', function(){
    client.setBroadcast(true);
    client.addMembership('225.0.0.' + OD4SESSION_CID);
});

client.on('message', function(msg){
    ws.clients.forEach(function each(client) {
        if (client.readyState == 1 /*WebSocket.OPEN*/) {
            client.send(msg);
        }
    });
});

