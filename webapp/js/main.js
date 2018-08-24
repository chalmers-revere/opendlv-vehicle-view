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

var g_ws;
var g_libcluon;
var g_recording = false;
var g_buttonPlayState = "play";
var g_infiniteButton = false;
var g_userIsSteppingForward = false;
var g_envelopeCounter = 0;
var g_mapOfMessages = {};
var g_sendFromCode = false;
var g_map;
var g_perception = {
    front : 0,
    rear : 0,
    left : 0,
    right : 0
};


$(document).ready(function(){
    setupUI();
});

////////////////////////////////////////////////////////////////////////////////
// WebRTC stuff.
var sdpConstraints = { optional: [{RtpDataChannels: true}] };
var g_pcSettings = [
  {
    iceServers: [{url:'stun:stun.l.google.com:19302'}]
  },
  {
    'optional': [{DtlsSrtpKeyAgreement: false}]
  }
];

var g_pc = new RTCPeerConnection(g_pcSettings);
var g_dc = null;

function isArrayBuffer(obj) {
    return obj instanceof ArrayBuffer ||
          (obj != null && obj.constructor != null && obj.constructor.name === 'ArrayBuffer' && typeof obj.byteLength === 'number')
}

function dcInit(dc) {
    dc.onopen = function() {
        $("#connectionStatusText").html("OpenDLV Vehicle View (connected/WebRTC)");
    };

    dc.onmessage = function(e) {if (e.data) {
        var d = e.data;
        if (isArrayBuffer(d)) {
            processEnvelope(e.data);
        }
        else {
            var fileReader = new FileReader();
            fileReader.onload = function(event) {
                var arrayBuffer;
                arrayBuffer = event.target.result;
                processEnvelope(arrayBuffer);
            };
            fileReader.readAsArrayBuffer(e.data);
        }
    }};
}

g_pc.ondatachannel = function(e) {
    g_dc = e.channel;
    dcInit(g_dc);
};

g_pc.onicecandidate = function(e) {
    if (e.candidate) return;

    var joiner_sdp = JSON.stringify(g_pc.localDescription);
    var jsdp = { "joinerSDP": joiner_sdp};
    g_ws.send(JSON.stringify(jsdp));
};
g_pc.oniceconnectionstatechange = function(e) {
    var state = g_pc.iceConnectionState;
    console.log("WebRTC state: " + state);
    if ("failed" == state) {
        var failed = { "webRTCclientState": "failed"};
        g_ws.send(JSON.stringify(failed));
        g_dc = null;
    }
};

////////////////////////////////////////////////////////////////////////////////

var $tableMessagesOverview = $('#table-messages-overview');
var sensorView;
function processEnvelope(incomingData) {
    var data = JSON.parse(g_libcluon.decodeEnvelopeToJSON(incomingData));
    g_envelopeCounter++;

    // Message overview.
    if ( (data.dataType > 0) && (data.dataType != 9 /*Ignore PlayerCommand*/) && (data.dataType != 10 /*Ignore PlayerStatus*/) ) {
        // Do book keeping of envelopes.
        var currentTimeStamp = data.sampleTimeStamp.seconds * 1000 * 1000 + data.sampleTimeStamp.microseconds;

        var date = new Date(currentTimeStamp/1000);
        var year = date.getFullYear();
        var month = "0" + (date.getMonth()+1);
        var day = "0" + date.getDate();
        var hours = date.getHours();
        var minutes = "0" + date.getMinutes();
        var seconds = "0" + date.getSeconds();

        var formattedTime = year + '-' + month.substr(-2) + '-' + day.substr(-2) + ' ' + hours + ':' + minutes.substr(-2) + ':' + seconds.substr(-2);
        $("#containerTimeStamp").html(formattedTime);
        $("#containerTimeStampUnix").html(Math.floor(currentTimeStamp/1000) + " ms");

        var informationAboutEnvelopesKey = data.dataType + "/" + data.senderStamp;
        if (!(informationAboutEnvelopesKey in g_mapOfMessages)) {
            g_mapOfMessages[informationAboutEnvelopesKey] = { sampleTimeStamp: 0,
                                                              envelope: {} };
        }
        var informationAboutEnvelopes = g_mapOfMessages[informationAboutEnvelopesKey];
        informationAboutEnvelopes.sampleTimeStamp = currentTimeStamp;
        informationAboutEnvelopes.envelope = data;
        g_mapOfMessages[informationAboutEnvelopesKey] = informationAboutEnvelopes;

        // Update message details.
        if ( g_userIsSteppingForward || (0 == (g_envelopeCounter % 10)) ) {
            var $tableMessagesDetails = $('#table-messages-details');
            $tableMessagesDetails.empty(); // empty is more explicit

            var $row = $('<tr>').appendTo($tableMessagesDetails);
            $('<th>').text("ID").appendTo($row);
            $('<th>').text("senderStamp").appendTo($row);
            $('<th>').text("message name").appendTo($row);
            $('<th>').text("sample timestamp [µs]").appendTo($row);
            $('<th>').text("signal(s)").appendTo($row);

            for (var k in g_mapOfMessages) {
                var $row = $('<tr>').appendTo($tableMessagesDetails);
                $('<td>').text(g_mapOfMessages[k].envelope.dataType).appendTo($row);
                $('<td>').text(g_mapOfMessages[k].envelope.senderStamp).appendTo($row);
                $('<td>').text(Object.keys(g_mapOfMessages[k].envelope)[5]).appendTo($row);
                $('<td>').text(g_mapOfMessages[k].sampleTimeStamp).appendTo($row);
                var msg = g_mapOfMessages[k].envelope[Object.keys(g_mapOfMessages[k].envelope)[5]];

                var tmp = "";
                for (var j in msg) {
                    var v = msg[j];
                    tmp += j;
                    if ((typeof msg[j]) == 'string') {
                        if (v.length > 10) {
                            v = " (base64) " + v.substr(0, 10) + "...";
                        }
                        else {
                            v = window.atob(v);
                        }
                    }
                    tmp += ": " + v + "<br>";
                }
                $('<td>').html(tmp).appendTo($row);
            }
        }

        if (0 == (g_envelopeCounter % 10)) {
            $tableMessagesOverview.empty(); // empty is more explicit

            for (var k in g_mapOfMessages) {
                var $row = $('<tr>').appendTo($tableMessagesOverview);
                var $msg = $('<td>').text(Object.keys(g_mapOfMessages[k].envelope)[5]);
                $msg.appendTo($row);
            }
        }
    }

    // opendlv_proxy_GeodeticWgs84Reading
    if (19 == data.dataType) {
        var c = [data.opendlv_proxy_GeodeticWgs84Reading.longitude, data.opendlv_proxy_GeodeticWgs84Reading.latitude];
        g_map.setCenter(c);
        return;
    }

    // opendlv_proxy_VoltageReading
    if (1037 == data.dataType) {
        var distance = 1.0 / (data.opendlv_proxy_VoltageReading.voltage / 10.13) - 3.8;
        distance /= 100.0;
        distance = (distance > 4.0) ? 4.0 : distance;

        var sensor = 0;
        var sensorOffset = 0;
        if (1 == data.senderStamp) {
            // IR left.
            const IRleft = 2;
            const IRleftOffset = 8;
            sensor = IRleft;
            sensorOffset = IRleftOffset;
            g_perception.left = distance;
        }
        else if (3 == data.senderStamp) {
            // IR right.
            const IRright = 3;
            const IRrightOffset = 2;
            sensor = IRright;
            sensorOffset = IRrightOffset;
            g_perception.right = distance;
        }
        sensorView.chart.data.datasets[sensor].data[(sensorOffset+0)%12] = distance;
        sensorView.chart.data.datasets[sensor].data[(sensorOffset+1)%12] = distance;
        sensorView.chart.data.datasets[sensor].data[(sensorOffset+2)%12] = distance;
        sensorView.update(0);
    }

    // opendlv_proxy_DistanceReading
    if (1039 == data.dataType) {
        var distance = data.opendlv_proxy_DistanceReading.distance;
        distance = (distance > 4.0) ? 4.0 : distance;

        var sensor = 0;
        var sensorOffset = 0;
        if (0 == data.senderStamp) {
            // Ultrasound front.
            const USfront = 0;
            const USfrontOffset = 11;
            sensor = USfront;
            sensorOffset = USfrontOffset;
            g_perception.front = distance;
        }
        else if (2 == data.senderStamp) {
            // Ultrasound rear.
            const USrear = 1;
            const USrearOffset = 5;
            sensor = USrear;
            sensorOffset = USrearOffset;
            g_perception.rear = distance;
        }
//        else if (1 == data.senderStamp) {
//            // IR left.
//            const IRleft = 2;
//            const IRleftOffset = 8;
//            sensor = IRleft;
//            sensorOffset = IRleftOffset;
//            g_perception.left = distance;
//        }
//        else if (3 == data.senderStamp) {
//            // IR right.
//            const IRright = 3;
//            const IRrightOffset = 2;
//            sensor = IRright;
//            sensorOffset = IRrightOffset;
//            g_perception.right = distance;
//        }
        sensorView.chart.data.datasets[sensor].data[(sensorOffset+0)%12] = distance;
        sensorView.chart.data.datasets[sensor].data[(sensorOffset+1)%12] = distance;
        sensorView.chart.data.datasets[sensor].data[(sensorOffset+2)%12] = distance;
        sensorView.update(0);
    }

    // opendlv_proxy_ImageReading
    if ( (1055 == data.dataType) && (0 == data.senderStamp) ) {
        // Mapping function to make wide chars to regular bytes.
        strToAB = str =>
         new Uint8Array(str.split('')
           .map(c => c.charCodeAt(0))).buffer;

        var FRAMEFORMAT = window.atob(data.opendlv_proxy_ImageReading.fourcc);
        if ("h264" == FRAMEFORMAT) {
            decodeAndRenderH264('videoFrame',
                                data.opendlv_proxy_ImageReading.width,
                                data.opendlv_proxy_ImageReading.height,
                                strToAB(window.atob(data.opendlv_proxy_ImageReading.data)));
        }
        if ( ("VP80" == FRAMEFORMAT) ||
             ("VP90" == FRAMEFORMAT) ) {
            decodeAndRenderVPX('videoFrame',
                               data.opendlv_proxy_ImageReading.width,
                               data.opendlv_proxy_ImageReading.height,
                               strToAB(window.atob(data.opendlv_proxy_ImageReading.data)),
                               FRAMEFORMAT);
        }
        return;
    }

    if (data.dataType == 10 /*PlayerStatus*/) {
        if (IS_PLAYBACK_PAGE) {
            var total = data.cluon_data_PlayerStatus.numberOfEntries;
            var current = data.cluon_data_PlayerStatus.currentEntryForPlayback;
            if (total > 0) {
                var slider = document.getElementById("playbackrange");
                slider.value = current * 100 / total;
            }
            if (g_infiniteButton && (100 == slider.value)) {
                remotePlayer('replayStartOver');
            }
            return;
        }
    }
}

function setupUI() {
    $('#videoFrame').attr({width:640,height:480}).css({width:'640px',height:'480px'});
    g_libcluon = libcluon();

    function getResourceFrom(url) {
        var xmlHttp = new XMLHttpRequest();
        xmlHttp.open("GET", url, false /*asynchronous request*/);
        xmlHttp.send(null);
        return xmlHttp.responseText;
    }

    if ("WebSocket" in window) {
        g_ws = new WebSocket("ws://" + window.location.host + "/", "od4");
        g_ws.binaryType = 'arraybuffer';

        g_ws.onopen = function() {
            if (IS_PLAYBACK_PAGE) {
                $("#connectionStatusSymbol").removeClass("fa fa-taxi").addClass("far fa-play-circle");
            }
            $("#connectionStatusSymbol").css("color", "#3CB371");
            $("#connectionStatusText").css("color", "#3CB371");
            $("#connectionStatusText").html("OpenDLV Vehicle View (connected)");

            var odvd = getResourceFrom(ODVD_FILE);
            console.log("Loaded " + g_libcluon.setMessageSpecification(odvd) + " messages from specification '" + ODVD_FILE + "'.");

            // Establish WebRTC connection (only when we are not running locally).
            var loc = " " + window.location.href;
            if (!( (-1 != loc.indexOf("localhost")) || (-1 != loc.indexOf("127.0.0.1")) )) {
                var req = { "getWebRTCOffer": true};
                g_ws.send(JSON.stringify(req));
            }
        };

        g_ws.onclose = function() {
            $("#connectionStatusSymbol").css("color", "#555");
            $("#connectionStatusText").css("color", "#555");
            $("#connectionStatusText").html("OpenDLV Vehicle View (disconnected)");
        };

        g_ws.onmessage = function(evt) {
            // This method will pass an OpenDaVINCI container to libcluon to parse it into a JSON object using the provided message specification.
            // Test for regular JSON.
            var msg = evt.data;
            if ( /* Ensure we have pure JSON. */ (msg[0] == '{') && (msg[msg.length-1] == '}') ) {
                var resp = JSON.parse(msg);
                Object.keys(resp).forEach(function(key) {
                    if ('webRTCOffer' == key) {
                        console.log("Got offer: " + JSON.parse(resp.webRTCOffer));

                        var offerDesc = new RTCSessionDescription(JSON.parse(resp.webRTCOffer));
                        g_pc.setRemoteDescription(offerDesc)
                        g_pc.createAnswer(function (answerDesc) {
                                g_pc.setLocalDescription(answerDesc)
                            }, function () {console.warn("Couldn't create offer")},
                            sdpConstraints);
                    }
                });
                return;
            }

            // (else) Envelope from libcluon.
            processEnvelope(evt.data);
        }
    }
    else {
        console.log("Error: websockets not supported by your browser.");
    }

    if (IS_PLAYBACK_PAGE) {
        var slider = document.getElementById("playbackrange");
        slider.addEventListener("change", function() {
            remotePlayerJSON = "{\"command\":3,\"seekTo\":" + (this.value/100) + "}";
            console.log(remotePlayerJSON);

            var output = g_libcluon.encodeEnvelopeFromJSONWithoutTimeStamps(remotePlayerJSON, 9 /* message identifier */, 0  /* sender stamp */);

//                strToAB = str =>
//                  new Uint8Array(str.split('')
//                    .map(c => c.charCodeAt(0))).buffer;

//     Instead of sending the raw bytes, we encapsulate them into a JSON object.
//                ws.send(strToAB(output), { binary: true });

            var commandJSON = "{\"remoteplayback\":" + "\"" + window.btoa(output) + "\"" + "}";
            g_ws.send(commandJSON);
        });
    }

    if ("Kiwi" == g_vehicle) {
        sensorView = new Chart(document.getElementById("sensorView"), {
            type: 'radar',
            data: {
                labels: ['0', '30', '60', '90', '120', '150', '180', '210', '240', '270', '300', '330'],
                datasets: [
                    {
                        label: "US front",
                        borderColor: "#3498DB",
                        data: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
                    }, 
                    {
                        label: "US rear",
                        borderColor: "#00BFFF",
                        data: [0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0],
                    }, 
                    {
                        label: "IR left",
                        borderColor: "#FF8000",
                        data: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0],
                    }, 
                    {
                        label: "IR right",
                        borderColor: "#FF0000",
                        data: [0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
                    }, 
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                scale: {
                    ticks: {
                        beginAtZero: true,
                        max: 4
                    }
                },
                title: {
                    display: true,
                    text: 'Sensor Bird\'s Eye View'
                }
            }
        });
    }

    ////////////////////////////////////////////////////////////////////////////
    g_map = new maptalks.Map("map",{
        center : [-118.150127,33.779397],
        pitch : 0,
        bearing : 0,
        zoom : 17,
        centerCross: true,
        attribution : {
          'content' : '<span style="padding:4px"><font size=1>&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a></font> </span>'
        },
            // a custom version of default web-mercator spatial reference
            // map's spatial reference definition
            spatialReference : {
              projection : 'EPSG:3857', // geo projection, can be a string or a function
              resolutions : [           // map's zoom levels and resolutions
                156543.03392804097,
                78271.51696402048,
                9135.75848201024,
                19567.87924100512,
                9783.93962050256,
                4891.96981025128,
                2445.98490512564,
                1222.99245256282,
                611.49622628141,
                305.748113140705,
                152.8740565703525,
                76.43702828517625,
                38.21851414258813,
                19.109257071294063,
                9.554628535647032,
                4.777314267823516,
                2.388657133911758,
                1.194328566955879,
                0.5971642834779395,
                0.29858214173896974,
                0.1492910709,
                0.07464553543,
                0.03732276771
              ],
              fullExtent : {         // map's full extent
                'top': 6378137 * Math.PI,
                'left': -6378137 * Math.PI,
                'bottom': -6378137 * Math.PI,
                'right': 6378137 * Math.PI
              }
            },
            baseLayer : new maptalks.TileLayer('base',{
              urlTemplate: 'http://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
              subdomains: ['a','b','c','d'],
              tileSystem : [1, -1, -20037508.34, 20037508.34], // tile system
              minZoom : 1,
              maxZoom : 23
            })
    });

    ////////////////////////////////////////////////////////////////////////////
    function updateFromCode() {
        if ("Kiwi" == g_vehicle) {
            const perception = g_perception;

            var actuation = { motor : 0,
                              steering : 0
            };

            // Run user's code.
            var editor = ace.edit("editor");
            var code = editor.getValue();
            eval(code);

            var envPedalPositionRequest;
            var envGroundSteeringRequest;
            var envActuationRequest;

            // Values for Kiwi.
            var minSteering = 0; // Number(document.getElementById("minSteering").value)
            var maxSteering = 38; // Number(document.getElementById("maxSteering").value)
            var maxAcceleration = 25; // Number(document.getElementById("maxAcceleration").value)
            var maxDeceleration = 100; // Number(document.getElementById("maxDeceleration").value)

            var steering = 0;
            var gasPedalPosition = 0;
            var brakePedalPosition = 0;

            // Support for PedalPositionRequest & GroundSteeringRequest.
            {
                gasPedalPosition = Math.floor(Math.min(actuation.motor, maxAcceleration/100.0)*100.0)/100.0;
                brakePedalPosition = Math.floor(Math.max(actuation.motor, maxAcceleration/-100.0)*100.0)/100.0;

                var pedalPositionRequest = "{\"position\":" + (actuation.motor > 0 ? gasPedalPosition : brakePedalPosition) + "}";
                envPedalPositionRequest = g_libcluon.encodeEnvelopeFromJSONWithSampleTimeStamp(pedalPositionRequest, 1086 /* message identifier */, 0 /* sender stamp */);


                steering = actuation.steering;
                if (steering < -maxSteering*Math.PI/180.0) {
                    steering = -maxSteering*Math.PI/180.0;
                }
                else if (steering > maxSteering*Math.PI/180.0) {
                    steering = maxSteering*Math.PI/180.0;
                }
                steering = Math.floor(steering*100.0)/100.0;

                var groundSteeringRequest = "{\"groundSteering\":" + steering + "}";
                envGroundSteeringRequest = g_libcluon.encodeEnvelopeFromJSONWithSampleTimeStamp(groundSteeringRequest, 1090 /* message identifier */, 0 /* sender stamp */);
            }

            // Disable support for legacy ActuationRequest.
            {
                var actuationRequest = "{\"acceleration\":0,\"steering\":0,\"isValid\":false}";
                envActuationRequest = g_libcluon.encodeEnvelopeFromJSONWithSampleTimeStamp(actuationRequest, 160 /* message identifier */, 0 /* sender stamp */);

//                strToAB = str =>
//                  new Uint8Array(str.split('')
//                    .map(c => c.charCodeAt(0))).buffer;

//                // Instead of sending the raw bytes, we encapsulate them into a JSON object.
                ws.send(strToAB(output), { binary: true });
            }

            var actuationCommands = "{\"virtualjoystick\":" +
                                        "{" +
                                            "\"pedalPositionRequest\":" + "\"" + window.btoa(envPedalPositionRequest) + "\"," +
                                            "\"groundSteeringRequest\":" + "\"" + window.btoa(envGroundSteeringRequest) + "\"," +
                                            "\"actuationRequest\":" + "\"" + window.btoa(envActuationRequest) + "\"" +
                                        "}" +
                                    "}";

            if (g_sendFromCode) {
                if (null != g_dc) {
                    g_dc.send(actuationCommands);
                }
                else {
                    g_ws.send(actuationCommands);
                }

                $("#steering").html(steering);
                $("#motor").html((gasPedalPosition > 0 ? gasPedalPosition : brakePedalPosition));
            }
        }
    }

    ////////////////////////////////////////////////////////////////////////////
    $('body').on('click', 'button#record', function() {
        g_recording = !g_recording;
        if (g_recording) {
            $('button#record').css('color', '#D00');
            g_ws.send("{ \"record\": true }", { binary: false });
        }
        else {
            $('button#record').css('color', '#555');
            g_ws.send("{ \"record\": false }", { binary: false });
        }
    });

    ////////////////////////////////////////////////////////////////////////////
    setInterval(function() {
        updateFromCode();
    }, 1/10 /* 10Hz */ * 1000);

    ////////////////////////////////////////////////////////////////////////////
    window.addEventListener("beforeunload", function (e) {
        if (IS_LIVE_PAGE) {
            var confirmationMessage = "Recording is ongoing that will be canceled when leaving this page.";
            if (g_recording) {
                (e || window.event).returnValue = confirmationMessage; //Gecko + IE
                return confirmationMessage;                            //Webkit, Safari, Chrome
            }
        }
        if (IS_PLAYBACK_PAGE) {
            fetch('/endreplay', { method: 'post',
                                headers: {
                                    'Accept': 'application/json, text/plain, */*',
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({endReplay: true})
                               }
            )
            .then(function(response) {
                if (response.ok) {
                    return;
                }
                throw new Error('Request failed.');
                })
            .catch(function(error) {
                console.log(error);
            });
        }
    });
}

////////////////////////////////////////////////////////////////////////////////

function updateSendingButtons() {
    if ("Kiwi" == g_vehicle) {
        if (g_sendFromCode) {
            $("#enableSendingCode").removeClass("fas fa-toggle-off").addClass("fas fa-toggle-on");
            $("#enableSendingCode").css("color", "#3CB371");
        }
        else {
            $("#enableSendingCode").removeClass("fas fa-toggle-on").addClass("fas fa-toggle-off");
            $("#enableSendingCode").css("color", "#555");
        }

        // Stop Kiwi.
        if (!g_sendFromCode) {
            var groundSteeringRequest = "{\"groundSteering\":0}";
            var envGroundSteeringRequest = g_libcluon.encodeEnvelopeFromJSONWithSampleTimeStamp(groundSteeringRequest, 1090 /* message identifier */, 0 /* sender stamp */);

            var pedalPositionRequest = "{\"position\":0}";
            var envPedalPositionRequest = g_libcluon.encodeEnvelopeFromJSONWithSampleTimeStamp(pedalPositionRequest, 1086 /* message identifier */, 0 /* sender stamp */);

            var actuationCommands = "{\"virtualjoystick\":" +
                                        "{" +
                                            "\"pedalPositionRequest\":" + "\"" + window.btoa(envPedalPositionRequest) + "\"," +
                                            "\"groundSteeringRequest\":" + "\"" + window.btoa(envGroundSteeringRequest) + "\"" +
                                        "}" +
                                    "}";
            if (null != g_dc) {
                g_dc.send(actuationCommands);
            }
            else {
                g_ws.send(actuationCommands);
            }
        }
    }
}

function enableSendingCodeToggled() {
    g_sendFromCode = !g_sendFromCode;
    updateSendingButtons();
}

////////////////////////////////////////////////////////////////////////////////

function endReplay(goLive) {
    fetch('/endreplay', { method: 'post',
                        headers: {
                            'Accept': 'application/json, text/plain, */*',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({endReplay: true})
                       }
    )
    .then(function(response) {
        if (response.ok) {
            if (goLive) {
                window.location = "/";
            }
            else {
                window.location = "/recordings";
            }
            return;
        }
        throw new Error('Request failed.');
        })
    .catch(function(error) {
        console.log(error);
    });
}


function remotePlayer(value) {
    var commandValue = 0;
    if ('playButton' == value) {
        g_userIsSteppingForward = false;
        if ("play" == g_buttonPlayState) {
            g_buttonPlayState = "pause";
            $("#playButton").removeClass("fas fa-pause").addClass("fas fa-play");
            commandValue = 2;
        }
        else if ("pause" == g_buttonPlayState) {
            g_buttonPlayState = "play";
            $("#playButton").removeClass("fas fa-play").addClass("fas fa-pause");
            commandValue = 1;
        }
    }
    if ('stepForwardButton' == value) {
        g_userIsSteppingForward = true;
        g_buttonPlayState = "pause";
        $("#playButton").removeClass("fas fa-pause").addClass("fas fa-play");
        commandValue = 4;
    }
    if ('replayStartOver' == value) {
        // Restart playback.
        if ("play" == g_buttonPlayState) {
            $("#playButton").removeClass("fas fa-play").addClass("fas fa-pause");
        }
        g_buttonPlayState = "play";
        commandValue = 1;

        // Send seekTo beginning function.
        setTimeout(function() {
            // Seek to beginning.
            var remotePlayerJSON = "{\"command\":3,\"seekTo\":0}";
            var output = g_libcluon.encodeEnvelopeFromJSONWithoutTimeStamps(remotePlayerJSON, 9 /* message identifier */, 0  /* sender stamp */);
            var commandJSON = "{\"remoteplayback\":" + "\"" + window.btoa(output) + "\"" + "}";

            g_ws.send(commandJSON);
            var slider = document.getElementById("playbackrange");
            slider.value = 1;
        }, 300);
    }
    if ('infiniteButton' == value) {
        g_infiniteButton = !g_infiniteButton;

        if (g_infiniteButton) {
            $('button#infiniteButton').css('color', '#3CB371');
        }
        else {
            $('button#infiniteButton').css('color', '#555');
        }
    }

    var remotePlayerJSON = "{\"command\":" + commandValue + "}";

    var output = g_libcluon.encodeEnvelopeFromJSONWithoutTimeStamps(remotePlayerJSON, 9 /* message identifier */, 0  /* sender stamp */);

//    strToAB = str =>
//      new Uint8Array(str.split('')
//        .map(c => c.charCodeAt(0))).buffer;

//    // Instead of sending the raw bytes, we encapsulate them into a JSON object.
//    g_ws.send(strToAB(output), { binary: true });

    var commandJSON = "{\"remoteplayback\":" + "\"" + window.btoa(output) + "\"" + "}";
    g_ws.send(commandJSON);
}

