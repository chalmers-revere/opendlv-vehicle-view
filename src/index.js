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
    console.log('Listening on port: ' + port);
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
                console.log('Started cluon-OD4toStdout, PID: ' + process_cluonOD4toStdout.pid);
            }
            else {
                kill(process_cluonOD4toStdout.pid);
                console.log('Stopped cluon-OD4toStdout, PID: ' + process_cluonOD4toStdout.pid);
            }
        }
    });
});

////////////////////////////////////////////////////////////////////////////////
// Connect to live OD4Session to broadcast messages to connected websocket clients.
var LIVE_OD4SESSION_CID = process.env.OD4SESSION_CID || 111;

var liveOD4Session = dgram.createSocket({reuseAddr:true, type:'udp4'});
liveOD4Session.bind(12175 /*OD4Session UDP multicast port. */);
liveOD4Session.on('listening', function(){
    liveOD4Session.setBroadcast(true);
    liveOD4Session.addMembership('225.0.0.' + LIVE_OD4SESSION_CID);
});

liveOD4Session.on('message', function(msg){
    ws.clients.forEach(function each(client) {
        if (client.readyState == 1 /*WebSocket.OPEN*/) {
            client.send(msg);
        }
    });
});

////////////////////////////////////////////////////////////////////////////////
// Connect to playback OD4Session to broadcast messages to connected websocket clients.
var PLAYBACK_OD4SESSION_CID = 253;

var playbackOD4Session = dgram.createSocket({reuseAddr:true, type:'udp4'});
playbackOD4Session.bind(12175 /*OD4Session UDP multicast port. */);
playbackOD4Session.on('listening', function(){
    playbackOD4Session.setBroadcast(true);
    playbackOD4Session.addMembership('225.0.0.' + PLAYBACK_OD4SESSION_CID);
});

playbackOD4Session.on('message', function(msg){
    ws.clients.forEach(function each(client) {
        if (client.readyState == 1 /*WebSocket.OPEN*/) {
            client.send(msg);
        }
    });
});

