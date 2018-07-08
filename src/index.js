// Copyright (C) 2018  Christian Berger
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Dependencies.
var dgram = require('dgram');
const fs = require('fs');
var express = require("express");
var exphbs  = require('express-handlebars');
const { exec } = require('child_process');

////////////////////////////////////////////////////////////////////////////////
// Killing process groups (used to stop cluon-OD4toStdout.
var psTree = require('ps-tree');

var kill = function (pid) {
    signal = 'SIGKILL';
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

// Default landing page.
app.get("/", function(req, res) {
    res.sendFile(path.join(__dirname + '/index.html'));
});

//------------------------------------------------------------------------------
// Template engine.
app.engine('.hbs', exphbs({extname: '.hbs'}));
app.set('view engine', '.hbs');

//------------------------------------------------------------------------------
// Handle existing recording files.
const addThousandsSeparator = (x) => {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
app.get("/recordings", function(req, res) {
    const testFolder = './recordings';
    var files = { recfiles: [] };
    fs.readdirSync(testFolder).forEach(file => {
        var size = fs.statSync(path.join(testFolder + '/' + file)).size;
        size = addThousandsSeparator(size);
        files.recfiles.push({
            "name"      : file,
            "filename"  : testFolder + "/" + file,
            "size"      : size
        });
    });
    res.render('recordings', files);
});

//------------------------------------------------------------------------------
// Handle POST requests.
var bodyParser = require('body-parser');
app.use(bodyParser.json()); // support json encoded bodies
app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies

var replayRunning = false;
var process_cluonreplay;
app.post('/replayfile', (req, res) => {
    replayRunning = true;
    process_cluonreplay = exec('cluon-replay --cid=253 ' + req.body.recordingFileToPlay);
    console.log('[opendlv-vehicle-view] Started cluon-replay, PID: ' + process_cluonreplay.pid);

    res.send ({
        status      : "200",
        responseType: "string",
        response    : "success"
    });
});
app.post('/endreplay', (req, res) => {
    kill(process_cluonreplay.pid);
    console.log('[opendlv-vehicle-view] Stopped cluon-replay, PID: ' + process_cluonreplay.pid);

    res.send ({
        status      : "200",
        responseType: "string",
        response    : "success"
    });
    replayRunning = false;
});
app.post('/deleterecordingfile', (req, res) => {
    fs.unlink(req.body.recordingFileToDelete, function() {
        res.send ({
            status      : "200",
            responseType: "string",
            response    : "success"
        });
    });
});

//------------------------------------------------------------------------------
// Serve other static files.
app.get(/^(.+)$/, function(req, res){ 
    res.sendFile(path.join(__dirname + '/' + req.params[0]));
});

//------------------------------------------------------------------------------
// Start server.
var port = process.env.PORT || 8081;
var server = app.listen(port, function () {
    console.log('[opendlv-vehicle-view] Listening on port: ' + port);
})

////////////////////////////////////////////////////////////////////////////////
// Websocket stuff.
var process_cluonOD4toStdout;
const WebSocket = require('ws').Server;
const ws = new WebSocket({server});
ws.on('connection', function connection(ws) {
    ws.on('message', function(msg) {
        if ( (msg[0] == '{') && (msg[msg.length-1] == '}') ) {
            var data = JSON.parse(msg);
            if (data.record) {
                process_cluonOD4toStdout = exec('cluon-OD4toStdout --cid=111 > ./recordings/`date +CID-111-recording-%Y-%m-%d_%H%M%S.rec`');
                console.log('[opendlv-vehicle-view] Started cluon-OD4toStdout, PID: ' + process_cluonOD4toStdout.pid);
            }
            else {
                kill(process_cluonOD4toStdout.pid);
                console.log('[opendlv-vehicle-view] Stopped cluon-OD4toStdout, PID: ' + process_cluonOD4toStdout.pid);
            }
        }
    });
});

var broadcastMessage = function (msg, fromLive) {
    if ( ( (fromLive && !replayRunning) /* from live OD4Session */ ) ||
         ( (!fromLive && replayRunning) /* from replay OD4Session */ ) ) {
        ws.clients.forEach(function each(client) {
            if (client.readyState == 1 /*WebSocket.OPEN*/) {
                client.send(msg);
            }
        });
    }
};

////////////////////////////////////////////////////////////////////////////////
// Connect to live OD4Session to broadcast messages to connected websocket clients.
var LIVE_OD4SESSION_CID = process.env.OD4SESSION_CID || 111;

var liveOD4Session = dgram.createSocket({reuseAddr:true, type:'udp4'});
liveOD4Session.bind({ 'port' : 12175 /* OD4Session UDP multicast port */, 'address': '225.0.0.' + LIVE_OD4SESSION_CID, 'exclusive' : false });
liveOD4Session.on('listening', function() {
    liveOD4Session.addMembership('225.0.0.' + LIVE_OD4SESSION_CID);
});
liveOD4Session.on('message', function(msg, rinfo) {
    broadcastMessage(msg, true);
});

////////////////////////////////////////////////////////////////////////////////
// Connect to playback OD4Session to broadcast messages to connected websocket clients.
var PLAYBACK_OD4SESSION_CID = 253;

var playbackOD4Session = dgram.createSocket({reuseAddr:true, type:'udp4'});
playbackOD4Session.bind({ 'port' : 12175 /* OD4Session UDP multicast port */, 'address': '225.0.0.' + PLAYBACK_OD4SESSION_CID, 'exclusive' : false });
playbackOD4Session.on('listening', function() {
    playbackOD4Session.addMembership('225.0.0.' + PLAYBACK_OD4SESSION_CID);
});
playbackOD4Session.on('message', function(msg, rinfo) {
    broadcastMessage(msg, false);
});

