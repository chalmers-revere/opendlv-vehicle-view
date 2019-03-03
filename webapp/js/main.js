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
var g_watchlive = true;
var g_recording = false;
var g_buttonPlayState = "play";
var g_infiniteButton = false;
var g_userIsSteppingForward = false;
var g_envelopeCounter = 0;
var g_mapOfMessages = {};
var g_sendFromCode = false;
var g_senderStampForImageReadingToShow = 0;

// GPS map.
var g_map;

// GNU plot.
var g_gnuplot;
var g_gnuplotDoPlot = false;
var g_mapOfDataForGnuplot = {};

// Simulation view.
var g_centerNext = true;
var g_scale = 100;
var g_scrollX = 0;
var g_scrollY = 0;
var g_walls = [];

const MAX_POINTS_rplidar = 1000;
const MAX_POINTS_vlp16 = 63000;
const MAX_POINTS_hdl32e_12 = 63000;
const MAX_POINTS_hdl32e_11 = 63000;
const MAX_POINTS_hdl32e_9 = 63000;
var g_particles_pointcloud_rplidar;
var g_particles_pointcloud_vlp16;
var g_particles_pointcloud_hdl32e_12;
var g_particles_pointcloud_hdl32e_11;
var g_particles_pointcloud_hdl32e_9;
var GL_position_index_rplidar = 0;
var GL_position_index_vlp16 = 0;
var GL_position_index_hdl32e_12 = 0;
var GL_position_index_hdl32e_11 = 0;
var GL_position_index_hdl32e_9 = 0;

// Setup look-up table for interleaved vertical layers.
const verticalAngles16 = [-15.0, -13.0, -11.0, -9.0, -7.0, -5.0, -3.0, -1.0, 1.0, 3.0, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0];
const verticalAngles12_hdl32e = [-30.67, -29.33, -25.33, -21.32, -17.32, -13.31, -9.31, -5.3, -1.3, 2.71, 6.71, 10.72];
const verticalAngles11_hdl32e = [-28.0, -26.66, -22.66, -18.65, -14.65, -10.64, -6.64, -2.63, 1.37, 5.38, 9.38];
const verticalAngles9_hdl32e = [-23.99, -19.99, -15.98, -11.98, -7.97, -3.97, 0.04, 4.04, 8.05];

const verticalAngles12_vlp32c = [ -25.0, -15.639, -7.254, -4.667, -3.333, -2.333, -1.333, -0.333, 0.667, 1.667, 4.667, 15.0 ];
const verticalAngles11_vlp32c = [ -11.31, -8.843, -5.333, -3.667, -2.667, -1.667, -0.667, 0.333, 1.333, 3.333, 10.333 ];
const verticalAngles9_vlp32c = [ -6.148, -4.0, -3.0, -2.0, -1.0, 0.0, 1.0, 2.333, 7.0 ];

var g_perception = {
    front : 0,
    rear : 0,
    left : 0,
    right : 0
};


$(document).ready(function(){
    setupUI();
    setupSimulationView();
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
    if ( (data.dataType > 0) && (data.dataType != 9 /*Ignore PlayerCommand*/) && (data.dataType != 10 /*Ignore PlayerStatus*/) && (data.dataType != 11 /*Ignore RecorderCommand*/) ) {
        // Do book keeping of envelopes.
        var currentTimeStamp = data.sampleTimeStamp.seconds * 1000 * 1000 + data.sampleTimeStamp.microseconds;

        var date = new Date(currentTimeStamp/1000);
        var year = date.getUTCFullYear();
        var month = "0" + (date.getUTCMonth()+1);
        var day = "0" + date.getUTCDate();
        var hours = date.getUTCHours();
        var minutes = "0" + date.getUTCMinutes();
        var seconds = "0" + date.getUTCSeconds();

        var formattedTime = year + '-' + month.substr(-2) + '-' + day.substr(-2) + ' ' + hours + ':' + minutes.substr(-2) + ':' + seconds.substr(-2) + " (UTC)";
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
            $('<th>').text("action(s)").appendTo($row);
            $('<th>').text("ID").appendTo($row);
            $('<th>').text("senderStamp").appendTo($row);
            $('<th>').text("message name").appendTo($row);
            $('<th>').text("sample timestamp [µs]").appendTo($row);
            $('<th>').text("signal(s)").appendTo($row);

            for (var k in g_mapOfMessages) {
                var messageName = Object.keys(g_mapOfMessages[k].envelope)[5];
                var senderStamp = g_mapOfMessages[k].envelope.senderStamp;
                var msg = g_mapOfMessages[k].envelope[Object.keys(g_mapOfMessages[k].envelope)[5]];

                const key = messageName + "." + senderStamp;
                if (!(key in g_mapOfDataForGnuplot)) {
                    g_mapOfDataForGnuplot[key] = "";
                }

                var $row = $('<tr id="' + key + '">').appendTo($tableMessagesDetails);
                // Add action(s).
                if ( (1055 == g_mapOfMessages[k].envelope.dataType) &&
                     ("h264" == window.atob(msg["fourcc"])) &&
                     (640 == msg["width"]) &&
                     (480 == msg["height"]) ) {
                    // ImageReading dimensions allow for selection of thumbnail.
                    $('<td>').html('<button id="btn-' + key + '" type="button" class="fas fa-chart-bar" style="font-size:20px;color:#555;padding: 5px 30px;" title="Plot numerical signals." onclick=\'plotSignals("'+ key + '")\'></button><br><button id="btn-show-' + key + '" type="button" class="fas fa-film" style="font-size:20px;color:#555;padding: 5px 30px;" title="Select this stream for overview tab." onclick=\'selectVideoStream("'+ g_mapOfMessages[k].envelope.senderStamp + '")\'></button>').appendTo($row);
                }
                else {
                    $('<td>').html('<button id="btn-' + key + '" type="button" class="fas fa-chart-bar" style="font-size:20px;color:#555;padding: 5px 30px;" title="Plot numerical signals." onclick=\'plotSignals("'+ key + '")\'></button>').appendTo($row);
                }

                $('<td>').text(g_mapOfMessages[k].envelope.dataType).appendTo($row);
                $('<td>').text(senderStamp).appendTo($row);
                $('<td>').text(messageName).appendTo($row);
                $('<td>').text(g_mapOfMessages[k].sampleTimeStamp).appendTo($row);

                var tmp = "";
                var gnuplotDataEntry = "";
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

                    if ((typeof msg[j]) == 'number') {
                        gnuplotDataEntry += v + " ";
                    }

                    tmp += ": " + v + "<br>";
                }
                $('<td>').html(tmp).appendTo($row);

                // Add values for plotting.
                g_mapOfDataForGnuplot[key] += gnuplotDataEntry + '\n';
            }

            // Plot data.
            if (!g_gnuplot.isRunning && g_gnuplotDoPlot) {
                gnuplot_runScript();
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

    if (!g_watchlive) {
      return;
    }

    // opendlv_proxy_GeodeticWgs84Reading
    if ( (19 == data.dataType) && (0 == data.senderStamp) ) {
        var c = [data.opendlv_proxy_GeodeticWgs84Reading.longitude, data.opendlv_proxy_GeodeticWgs84Reading.latitude];
        g_map.setCenter(c);
        return;
    }

    // simulation messages
    if ( (1001 == data.dataType) && (g_enableKiwiSimulation) ) {
        addSimulationViewData(data);
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

            sensorView.chart.data.datasets[sensor].data = [0, 0, 0, 0, 0, 0, 0, 0, distance, distance, distance, 0];
        }
        else if (3 == data.senderStamp) {
            // IR right.
            const IRright = 3;
            const IRrightOffset = 2;
            sensor = IRright;
            sensorOffset = IRrightOffset;
            g_perception.right = distance;

            sensorView.chart.data.datasets[sensor].data = [0, 0, distance, distance, distance, 0, 0, 0, 0, 0, 0, 0];
        }

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

            sensorView.chart.data.datasets[sensor].data = [distance, distance, 0, 0, 0, 0, 0, 0, 0, 0, 0, distance];
        }
        else if (2 == data.senderStamp) {
            // Ultrasound rear.
            const USrear = 2;
            const USrearOffset = 5;
            sensor = USrear;
            sensorOffset = USrearOffset;
            g_perception.rear = distance;

            sensorView.chart.data.datasets[sensor].data = [0, 0, 0, 0, 0, distance, distance, distance, 0, 0, 0, 0];
        }
        else if (1 == data.senderStamp) {
            // IR left.
            const IRleft = 1;
            const IRleftOffset = 8;
            sensor = IRleft;
            sensorOffset = IRleftOffset;
            g_perception.left = distance;

            sensorView.chart.data.datasets[sensor].data = [0, 0, 0, 0, 0, 0, 0, 0, distance, distance, distance, 0];
        }
        else if (3 == data.senderStamp) {
            // IR right.
            const IRright = 3;
            const IRrightOffset = 2;
            sensor = IRright;
            sensorOffset = IRrightOffset;
            g_perception.right = distance;

            sensorView.chart.data.datasets[sensor].data = [0, 0, distance, distance, distance, 0, 0, 0, 0, 0, 0, 0];
        }

        sensorView.update(0);
    }

    // opendlv_proxy_ImageReading
    if ( (1055 == data.dataType) && (g_senderStampForImageReadingToShow == data.senderStamp) ) {
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

    // opendlv_proxy_PointCloudReading
    if (49 == data.dataType) {
        if ("Kiwi" != g_vehicle) {
            document.getElementById('ego-3dview').style.visibility = "visible";
            // CompactPointCloud
            var distances = window.atob(data.opendlv_proxy_PointCloudReading.distances);

            if (2 == data.opendlv_proxy_PointCloudReading.typeOfVerticalAngularLayout) {
                // Render for RPLidar.
                var startAzimuth = data.opendlv_proxy_PointCloudReading.startAzimuth;
                var numberOfPoints = distances.length / 4;

                var angles = window.atob(data.opendlv_proxy_PointCloudReading.azimuthAngles);
                var numberOfAngles = angles.length / 4;

                var GL_positions_rplidar = g_particles_pointcloud_rplidar.geometry.attributes.position.array;
                var GL_colors_rplidar = g_particles_pointcloud_rplidar.geometry.attributes.color.array;

                GL_positions_rplidar.fill(0);
                GL_colors_rplidar.fill(0);
                GL_position_index_rplidar = 0;

                var buffer = new ArrayBuffer(4);
                var f32 = new Float32Array(buffer);
                var ui8 = new Uint8Array(buffer);
                var r = 0;
                var g = 0;
                var b = 1.0;

                if (numberOfPoints == numberOfAngles) {
                    for (var index = 0; index < numberOfPoints; index++) {
                        ui8[0] = distances.charCodeAt(4*index+0);
                        ui8[1] = distances.charCodeAt(4*index+1);
                        ui8[2] = distances.charCodeAt(4*index+2);
                        ui8[3] = distances.charCodeAt(4*index+3);

                        var distance = f32[0];

                        ui8[0] = angles.charCodeAt(4*index+0);
                        ui8[1] = angles.charCodeAt(4*index+1);
                        ui8[2] = angles.charCodeAt(4*index+2);
                        ui8[3] = angles.charCodeAt(4*index+3);

                        var azimuth = f32[0];

                        const verticalAngle = 0;

                        var xyDistance = distance * Math.cos(verticalAngle * Math.PI/180.0);
                        var x = xyDistance * Math.sin(azimuth * Math.PI/180.0);
                        var y = xyDistance * Math.cos(azimuth * Math.PI/180.0);
                        var z = distance * Math.sin(verticalAngle * Math.PI/180.0);

                        if (GL_position_index_rplidar < MAX_POINTS_rplidar-3) {
                            GL_positions_rplidar[GL_position_index_rplidar] = x;
                            GL_colors_rplidar[GL_position_index_rplidar] = r;
                            GL_position_index_rplidar++;

                            GL_positions_rplidar[GL_position_index_rplidar] = z;
                            GL_colors_rplidar[GL_position_index_rplidar] = g;
                            GL_position_index_rplidar++;

                            GL_positions_rplidar[GL_position_index_rplidar] = -y;
                            GL_colors_rplidar[GL_position_index_rplidar] = b;
                            GL_position_index_rplidar++;
                        }
                    }
                }
                g_particles_pointcloud_rplidar.geometry.attributes.position.needsUpdate = true;
                g_particles_pointcloud_rplidar.geometry.attributes.color.needsUpdate = true;
            }
            else {
                // Differentiate between HDL32e and VLP32c.
                var verticalAngles12;
                var verticalAngles11;
                var verticalAngles9;
                if (0 == data.opendlv_proxy_PointCloudReading.typeOfVerticalAngularLayout) {
                    verticalAngles12 = verticalAngles12_hdl32e;
                    verticalAngles11 = verticalAngles11_hdl32e;
                    verticalAngles9 = verticalAngles9_hdl32e;
                }
                else if (1 == data.opendlv_proxy_PointCloudReading.typeOfVerticalAngularLayout) {
                    verticalAngles12 = verticalAngles12_vlp32c;
                    verticalAngles11 = verticalAngles11_vlp32c;
                    verticalAngles9 = verticalAngles9_vlp32c;
                }

                var numberOfBitsForIntensity = data.opendlv_proxy_PointCloudReading.numberOfBitsForIntensity;
                var startAzimuth = data.opendlv_proxy_PointCloudReading.startAzimuth;
                var endAzimuth = data.opendlv_proxy_PointCloudReading.endAzimuth;
                var entriesPerAzimuth = data.opendlv_proxy_PointCloudReading.entriesPerAzimuth;
                var numberOfPoints = distances.length / 2;
                var numberOfAzimuths = numberOfPoints / entriesPerAzimuth;
                var azimuthIncrement = (endAzimuth - startAzimuth) / numberOfAzimuths;

                var GL_positions_vlp16 = g_particles_pointcloud_vlp16.geometry.attributes.position.array;
                var GL_colors_vlp16 = g_particles_pointcloud_vlp16.geometry.attributes.color.array;

                var GL_positions_hdl32e_12 = g_particles_pointcloud_hdl32e_12.geometry.attributes.position.array;
                var GL_colors_hdl32e_12 = g_particles_pointcloud_hdl32e_12.geometry.attributes.color.array;

                var GL_positions_hdl32e_11 = g_particles_pointcloud_hdl32e_11.geometry.attributes.position.array;
                var GL_colors_hdl32e_11 = g_particles_pointcloud_hdl32e_11.geometry.attributes.color.array;

                var GL_positions_hdl32e_9 = g_particles_pointcloud_hdl32e_9.geometry.attributes.position.array;
                var GL_colors_hdl32e_9 = g_particles_pointcloud_hdl32e_9.geometry.attributes.color.array;

                // VLP16 sends 16 layers,
                if (16 == entriesPerAzimuth) {
                    GL_positions_vlp16.fill(0);
                    GL_colors_vlp16.fill(0);
                    GL_position_index_vlp16 = 0;
                }
                else if (12 == entriesPerAzimuth) {
                    // HDL32e sends the sequence 12, 11, 9 layers.
                    GL_positions_hdl32e_12.fill(0);
                    GL_colors_hdl32e_12.fill(0);
                    GL_position_index_hdl32e_12 = 0;
                }
                else if (11 == entriesPerAzimuth) {
                    GL_positions_hdl32e_11.fill(0);
                    GL_colors_hdl32e_11.fill(0);
                    GL_position_index_hdl32e_11 = 0;
                }
                else if (9 == entriesPerAzimuth) {
                    GL_positions_hdl32e_9.fill(0);
                    GL_colors_hdl32e_9.fill(0);
                    GL_position_index_hdl32e_9 = 0;
                }

                var index = 0;
                var azimuth = startAzimuth;
                for (var azimuthIndex = 0; azimuthIndex < numberOfAzimuths; azimuthIndex++) {
                    for (var sensorIndex = 0; sensorIndex < entriesPerAzimuth; sensorIndex++) {
                        var verticalAngle = 0;
                        if (16 == entriesPerAzimuth) {
                            verticalAngle = verticalAngles16[sensorIndex];
                        }
                        else if (12 == entriesPerAzimuth) {
                            verticalAngle = verticalAngles12[sensorIndex];
                        }
                        else if (11 == entriesPerAzimuth) {
                            verticalAngle = verticalAngles11[sensorIndex];
                        }
                        else if (9 == entriesPerAzimuth) {
                            verticalAngle = verticalAngles9[sensorIndex];
                        }

                        var byte0 = distances.charCodeAt(index++);
                        var byte1 = distances.charCodeAt(index++);
                        var distance = ( ((0xff & byte0) << 8) | (0xff & byte1) );

                        var r = 0;
                        var g = 0;
                        var b = 1.0;

                        // Extract intensity.
                        if (0 < numberOfBitsForIntensity) {
                            var MASK = ((~(0xFFFF >> numberOfBitsForIntensity))&0xFFFF); // restrict to uint16.
                            var extractedIntensity = distance & MASK;
                            extractedIntensity = extractedIntensity >> (16 - numberOfBitsForIntensity);
                            var intensityMaxValue = Math.round(Math.exp(Math.log(2) * numberOfBitsForIntensity) - 1);
                            var intensity = extractedIntensity / intensityMaxValue;

                            if ( (intensity > 1.0) || (0 > intensity) ) {
                                intensity = 0.5;
                            }

                            // Four color levels: blue, green, yellow, red from low intensity to high intensity
                            if (intensity < 0.25 + 1e-7) {
                                r = 0;
                                g = 0.5 + intensity * 2.0;
                                b = 1;
                            } else if (intensity > 0.25 && intensity < 0.5 + 1e-7) {
                                r = 0;
                                g = 0.5 + intensity * 2.0;
                                b = 0.5;
                            } else if (intensity > 0.5 && intensity < 0.75 + 1e-7) {
                                r = 1;
                                g = 0.75 + intensity;
                                b = 0;
                            } else {
                                r = 0.55 + intensity;
                                g = 0;
                                b = 0;
                            }

                            // Remove intensity from distance.
                            distance &= (0xFFFF >> numberOfBitsForIntensity);
                        }

                        distance /= 100.0;

                        if (distance > 1.0) {
                            var xyDistance = distance * Math.cos(verticalAngle * Math.PI/180.0);
                            var x = xyDistance * Math.sin(azimuth * Math.PI/180.0);
                            var y = xyDistance * Math.cos(azimuth * Math.PI/180.0);
                            var z = distance * Math.sin(verticalAngle * Math.PI/180.0);

                            if (16 == entriesPerAzimuth) {
                                if (GL_position_index_vlp16 < MAX_POINTS_vlp16-3) {
                                    GL_positions_vlp16[GL_position_index_vlp16] = x;
                                    GL_colors_vlp16[GL_position_index_vlp16] = r;
                                    GL_position_index_vlp16++;

                                    GL_positions_vlp16[GL_position_index_vlp16] = z;
                                    GL_colors_vlp16[GL_position_index_vlp16] = g;
                                    GL_position_index_vlp16++;

                                    GL_positions_vlp16[GL_position_index_vlp16] = -y;
                                    GL_colors_vlp16[GL_position_index_vlp16] = b;
                                    GL_position_index_vlp16++;
                                }

                            }
                            else if (12 == entriesPerAzimuth) {
                                if (GL_position_index_hdl32e_12 < MAX_POINTS_hdl32e_12-3) {
                                    GL_positions_hdl32e_12[GL_position_index_hdl32e_12] = x;
                                    GL_colors_hdl32e_12[GL_position_index_hdl32e_12] = r;
                                    GL_position_index_hdl32e_12++;

                                    GL_positions_hdl32e_12[GL_position_index_hdl32e_12] = z;
                                    GL_colors_hdl32e_12[GL_position_index_hdl32e_12] = g;
                                    GL_position_index_hdl32e_12++;

                                    GL_positions_hdl32e_12[GL_position_index_hdl32e_12] = -y;
                                    GL_colors_hdl32e_12[GL_position_index_hdl32e_12] = b;
                                    GL_position_index_hdl32e_12++;
                                }
                            }
                            else if (11 == entriesPerAzimuth) {
                                if (GL_position_index_hdl32e_11 < MAX_POINTS_hdl32e_11-3) {
                                    GL_positions_hdl32e_11[GL_position_index_hdl32e_11] = x;
                                    GL_colors_hdl32e_11[GL_position_index_hdl32e_11] = r;
                                    GL_position_index_hdl32e_11++;

                                    GL_positions_hdl32e_11[GL_position_index_hdl32e_11] = z;
                                    GL_colors_hdl32e_11[GL_position_index_hdl32e_11] = g;
                                    GL_position_index_hdl32e_11++;

                                    GL_positions_hdl32e_11[GL_position_index_hdl32e_11] = -y;
                                    GL_colors_hdl32e_11[GL_position_index_hdl32e_11] = b;
                                    GL_position_index_hdl32e_11++;
                                }
                            }
                            else if (9 == entriesPerAzimuth) {
                                if (GL_position_index_hdl32e_9 < MAX_POINTS_hdl32e_9-3) {
                                    GL_positions_hdl32e_9[GL_position_index_hdl32e_9] = x;
                                    GL_colors_hdl32e_9[GL_position_index_hdl32e_9] = r;
                                    GL_position_index_hdl32e_9++;

                                    GL_positions_hdl32e_9[GL_position_index_hdl32e_9] = z;
                                    GL_colors_hdl32e_9[GL_position_index_hdl32e_9] = g;
                                    GL_position_index_hdl32e_9++;

                                    GL_positions_hdl32e_9[GL_position_index_hdl32e_9] = -y;
                                    GL_colors_hdl32e_9[GL_position_index_hdl32e_9] = b;
                                    GL_position_index_hdl32e_9++;
                                }
                            }
                        }
                    }
                    azimuth += azimuthIncrement;
                }

                // Trigger update
                if (16 == entriesPerAzimuth) {
                    g_particles_pointcloud_vlp16.geometry.attributes.position.needsUpdate = true;
                    g_particles_pointcloud_vlp16.geometry.attributes.color.needsUpdate = true;
                }
                else if (12 == entriesPerAzimuth) {
                    g_particles_pointcloud_hdl32e_12.geometry.attributes.position.needsUpdate = true;
                    g_particles_pointcloud_hdl32e_12.geometry.attributes.color.needsUpdate = true;
                }
                else if (11 == entriesPerAzimuth) {
                    g_particles_pointcloud_hdl32e_11.geometry.attributes.position.needsUpdate = true;
                    g_particles_pointcloud_hdl32e_11.geometry.attributes.color.needsUpdate = true;
                }
                else if (9 == entriesPerAzimuth) {
                    g_particles_pointcloud_hdl32e_9.geometry.attributes.position.needsUpdate = true;
                    g_particles_pointcloud_hdl32e_9.geometry.attributes.color.needsUpdate = true;
                }
            }
        }
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

            if (IS_PLAYBACK_PAGE) {
                var lastIndex = FILENAME_TO_REPLAY.lastIndexOf('/');
                var filename = FILENAME_TO_REPLAY.substr(lastIndex + 1);
                $("#filenameCurrentlyReplaying").html("<a href=\"" + FILENAME_TO_REPLAY + "\" style=\"font-size: 10px; text-decoration: none\">" + filename + "</a>");
            }

            var odvd = getResourceFrom(ODVD_FILE);
            if (!HAS_EXTERNAL_ODVD_FILE) {
                // Always add the messages to control the remote player and to actuation request.
                var playerMessages = `

message cluon.data.PlayerCommand [id = 9] {
    uint8 command [id = 1]; // 0 = nothing, 1 = play, 2 = pause, 3 = seekTo, 4 = step
    float seekTo [id = 2];
}

message cluon.data.PlayerStatus [id = 10] {
    uint8 state [id = 1]; // 0 = unknown, 1 = loading file, 2 = playback
    uint32 numberOfEntries [id = 2];
    uint32 currentEntryForPlayback [id = 3];
}

message cluon.data.RecorderCommand [id = 11] {
    uint8 command [id = 1]; // 0 = nothing, 1 = record, 2 = stop
}

// This message is a legacy one to support controlling Snowfox and Rhino.
message opendlv.proxy.ActuationRequest [id = 160] {
  float acceleration [id = 1];
  float steering [id = 2];
  bool isValid [id = 3];
}
`;
                odvd += playerMessages;
            }
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

    ////////////////////////////////////////////////////////////////////////////
    if (IS_PLAYBACK_PAGE) {
        var slider = document.getElementById("playbackrange");
        slider.addEventListener("change", function() {
            remotePlayerJSON = "{\"command\":3,\"seekTo\":" + (this.value/100) + "}";
            console.log(remotePlayerJSON);

            var output = g_libcluon.encodeEnvelopeFromJSONWithoutTimeStamps(remotePlayerJSON, 9 /* message identifier */, 0  /* sender stamp */);

//            strToAB = str =>
//              new Uint8Array(str.split('')
//                .map(c => c.charCodeAt(0))).buffer;

//            // Instead of sending the raw bytes, we encapsulate them into a JSON object.
//            ws.send(strToAB(output), { binary: true });

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
    setupGnuplot();

    ////////////////////////////////////////////////////////////////////////////
    if ("Kiwi" != g_vehicle) {
        setupPointCloudView();
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
    function clock() {
        var date = new Date(new Date().getTime());
        var year = date.getUTCFullYear();
        var month = "0" + (date.getUTCMonth()+1);
        var day = "0" + date.getUTCDate();
        var hours = date.getUTCHours();
        var minutes = "0" + date.getUTCMinutes();
        var seconds = "0" + date.getUTCSeconds();

        var formattedTime = year + '-' + month.substr(-2) + '-' + day.substr(-2) + ' ' + hours + ':' + minutes.substr(-2) + ':' + seconds.substr(-2) + " (UTC)";

        $('#currentTime').text(formattedTime);
        window.setTimeout(clock, 500);
    }
    window.setTimeout(clock, 500);

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
//                g_ws.send(strToAB(output), { binary: true });
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
    $('body').on('click', 'button#watchlive', function() {
        g_watchlive = !g_watchlive;
        if (g_watchlive) {
            $('button#watchlive').css('color', '#3CB371');
            $('button#watchlive').removeClass("fas fa-eye-slash").addClass("fas fa-eye");
            g_ws.send("{ \"watchlive\": true }", { binary: false });
        }
        else {
            $('button#watchlive').css('color', '#555');
            $('button#watchlive').removeClass("fas fa-eye").addClass("fas fa-eye-slash");
            g_ws.send("{ \"watchlive\": false }", { binary: false });
        }
    });

    ////////////////////////////////////////////////////////////////////////////
    $('body').on('click', 'button#record', function() {
        g_recording = !g_recording;

        var remoteCommandJSON;
        if (g_recording) {
            remoteCommandJSON = "{\"command\":1}";
        }
        else {
            remoteCommandJSON = "{\"command\":2}";
        }
        console.log(remoteCommandJSON);

        var output = g_libcluon.encodeEnvelopeFromJSONWithoutTimeStamps(remoteCommandJSON, 11 /* message identifier */, 0 /* sender stamp */);

//        strToAB = str =>
//          new Uint8Array(str.split('')
//            .map(c => c.charCodeAt(0))).buffer;

//        // Instead of sending the raw bytes, we encapsulate them into a JSON object.
//        ws.send(strToAB(output), { binary: true });

        if (g_recording) {
            $('button#record').css('color', '#D00');
            g_ws.send("{ \"record\": true,\"remoterecord\":" + "\"" + window.btoa(output) + "\"" + "}", { binary: false });
        }
        else {
            $('button#record').css('color', '#555');
            g_ws.send("{ \"record\": false,\"remoterecord\":" + "\"" + window.btoa(output) + "\"" + "}", { binary: false });
        }
    });

    ////////////////////////////////////////////////////////////////////////////
    setInterval(function() {
        updateFromCode();
    }, 1/10 /* 10Hz */ * 1000);

    ////////////////////////////////////////////////////////////////////////////
    document.addEventListener('keypress', (event) => {
        const pressedKey = event.key;
        var message = prompt("Please enter a comment to send to the OD4Session: ", pressedKey);
        if ( (null != message) && (message != "") ) {
            // Escape characters.
            message = message.replace(/[\\]/g, '\\\\')
                      .replace(/[\/]/g, '\\/')
                      .replace(/[\b]/g, '\\b')
                      .replace(/[\f]/g, '\\f')
                      .replace(/[\n]/g, '\\n')
                      .replace(/[\r]/g, '\\r')
                      .replace(/[\t]/g, '\\t')
                      .replace(/[\"]/g, '\\"')
                      .replace(/\\'/g, "\\'");

            var logMessage = "{\"level\":6,\"description\":\""+ window.btoa(message) + "\"}";
            var envLogMessage = g_libcluon.encodeEnvelopeFromJSONWithSampleTimeStamp(logMessage, 1103 /* message identifier */, 999 /* sender stamp */);
            var envLogMessageAsJSON = "{\"logmessage\":" +
                                      "\"" + window.btoa(envLogMessage) + "\"" + "}";
            g_ws.send(envLogMessageAsJSON);
        }
    });

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
/*
Based on: https://github.com/chalmers-revere/opendlv-ui-default/tree/f637b494b3a1ccc2cbf634fb0a193b01bc510f23/http

Copyright 2018 Ola Benderius

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
function setupSimulationView() {
  function getResourceFrom(url) {
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.open("GET", url, false);
    xmlHttp.send(null);
    return xmlHttp.responseText;
  }

  var map = getResourceFrom("simulation-map.txt");
  map.trim().split(";").forEach(function(wall) {
    const wallArray = wall.trim().split(",");
    if (wallArray.length == 4) {
      g_walls.push(wallArray);
    }
  });

  var clicked = false;
  var clickX;
  var clickY;
  $('#simulation-canvas').on({
    'mousemove': function(e) {
      if (clicked) {
        const deltaX = clickX - e.pageX;
        const deltaY = clickY - e.pageY;

        if (e.ctrlKey) {
          g_scale += deltaY;
          if (g_scale < 10) {
            g_scale = 10;
          }
          if (g_scale > 500) {
            g_scale = 500;
          }
        } else {
          g_scrollX += deltaX;
          g_scrollY += deltaY;
        }
     
        clickX = e.pageX;
        clickY = e.pageY;
      }
    },
    'mousedown': function(e) {
      $('html').css('cursor', 'all-scroll');
      clicked = true;
      clickX = e.pageX;
      clickY = e.pageY;
    },
    'mouseup': function() {
      clicked = false;
      $('html').css('cursor', 'auto');
    },
    'dblclick': function(e) {
      g_centerNext = true;
    }
  });
}

function addSimulationViewData(data) {
  if (data.dataType == 1001) {
    const x = data["opendlv_sim_Frame"]["x"];
    const y = data["opendlv_sim_Frame"]["y"];
    const yaw = data["opendlv_sim_Frame"]["yaw"];

    const width = 0.2;
    const length = 0.4;

    var canvas = document.getElementById("simulation-canvas");
    var context = canvas.getContext("2d");

    if (g_centerNext) {
      g_scrollX = -canvas.width / 2;
      g_scrollY = -canvas.height / 2;
      g_centerNext = false;
    }

    const sx = g_scale * x - g_scrollX;
    const sy = -g_scale * y - g_scrollY;
    const swidth = g_scale * width;
    const slength = g_scale * length;
    const syaw = -yaw;

    const hslength = slength / 2;
    const hswidth = swidth / 2;
    const fslength = slength / 4;

    context.clearRect(0, 0, canvas.width, canvas.height);

    context.save();
    context.beginPath();
    context.lineWidth = 2;
    context.translate(sx, sy);
    context.rotate(syaw);
    context.rect(-hslength, -hswidth, slength, swidth);
    context.moveTo(fslength, hswidth);
    context.lineTo(hslength, 0);
    context.moveTo(fslength, -hswidth);
    context.lineTo(hslength, 0);
    context.stroke();
    context.restore();

    for (const wallKey in g_walls) {
      const sx1 = g_scale * g_walls[wallKey][0] - g_scrollX;
      const sy1 = -g_scale * g_walls[wallKey][1] - g_scrollY;
      const sx2 = g_scale * g_walls[wallKey][2] - g_scrollX;
      const sy2 = -g_scale * g_walls[wallKey][3] - g_scrollY;
    
      context.save();
      context.beginPath();
      context.lineWidth = 5;
      context.moveTo(sx1, sy1);
      context.lineTo(sx2, sy2);
      context.stroke();
      context.restore();
    }
  }
}

////////////////////////////////////////////////////////////////////////////////
function gnuplot_selectPreset() {
    const selection = document.getElementById('gnuplot-preset').value;
    var plottingCode = "";
    if ("gps-trace" == selection) {
        plottingCode = `# Example for plotting opendlv_proxy_GeodeticWgs84Reading.0 as GPS trace using gnuplot.
set terminal svg size 500,400 enhanced fname 'arial' fsize 5 solid
set output 'out.svg'    # Output must always be named 'out.svg' to display.

set title 'opendlv\_proxy\_GeodeticWgs84Reading.0'
set xlabel 'Latitude'
set ylabel 'Longitude'
set key inside top left # Add legend box located at top/left.

plot "opendlv_proxy_GeodeticWgs84Reading.0" using 2:1 title 'GPS trace' with lines
`;
    }
    else if ("kiwi-distances" == selection) {
        plottingCode = `# Example for plotting opendlv_proxy_DistanceReading.0 from Kiwi using gnuplot.
set terminal svg size 500,400 enhanced fname 'arial' fsize 5 solid
set output 'out.svg'    # Output must always be named 'out.svg' to display.

set title 'opendlv\_proxy\_DistanceReading'
set xlabel 't'
set ylabel 'Distance [m]'
set key inside top left # Add legend box located at top/left.

plot "opendlv_proxy_DistanceReading.0" using 1 title 'US front' with lines, \
     "opendlv_proxy_DistanceReading.2" using 1 title 'US rear' with lines
`;
    }

    if ("" != plottingCode) {
        g_gnuplotDoPlot = true;
        document.getElementById("gnuplot-script").value = plottingCode;
        if (!g_gnuplot.isRunning) {
            gnuplot_runScript();
        }
    }
}

function selectVideoStream(val) {
    g_senderStampForImageReadingToShow = val;
    // Activate tab for overview.
    $('.nav-tabs a[href="#panel-feed"]').tab('show');
}

function plotSignals(val) {
    g_gnuplotDoPlot = true;
    var plottingCode = "# Example for plotting " + val + " data using gnuplot.\n";
    plottingCode += `set terminal svg size 500,400 enhanced fname 'arial' fsize 5 solid
set output 'out.svg'    # Output must always be named 'out.svg' to display.

`;

    plottingCode += "set title '" + val.replace(/_/g , "\\_") + "'\n";
    plottingCode += `set xlabel 'Value 1'    # Define label for x axis.
set ylabel 'Value 2'    # Define label for y axis.
set key inside top left # Add legend box located at top/left.

`;
    plottingCode += "# Plot first numerical signal of message '" + val + "'.\n";
    plottingCode += "# Replace 'using 1' with 'using 1:2' or similar to access other fields.\n\n";
    plottingCode += "# Actual call to plot data.\nplot \"" + val + "\" using 1 title 'Line 1' with lines\n";

    document.getElementById("gnuplot-script").value = plottingCode;
    if (!g_gnuplot.isRunning) {
        gnuplot_runScript();
    }

    // Activate tab for plotting.
    $('.nav-tabs a[href="#panel-plot"]').tab('show');
}

function setupGnuplot() {
    g_gnuplot = new Gnuplot("js/gnuplot.js");

    g_gnuplot.onOutput = function(text) {
        document.getElementById('gnuplot-output').value += text + '\n';
        document.getElementById('gnuplot-output').scrollTop = 99999;
    };
    g_gnuplot.onError = function(text) {
        document.getElementById('gnuplot-output').value += 'ERR: ' + text + '\n';
        document.getElementById('gnuplot-output').scrollTop = 99999;
    };
}

var g_lastTAContent = "";
function gnuplot_scriptChange() {
    var val = document.getElementById("gnuplot-script").value;
    if (g_lastTAContent == val) {
        return;
    }
    if (g_gnuplot.isRunning) {
        setTimeout(gnuplot_scriptChange, 1000);
    }
    else {
        g_lastTAContent = val;
        g_gnuplotDoPlot = true;
        gnuplot_runScript();
    }
}

var gnuplot_runScript = function() {
    if (!g_gnuplotDoPlot) {
        return;
    }

    var editor = document.getElementById('gnuplot-script');
    var start = Date.now();

    // Hand over message names to GNU plot.
    for (var k in g_mapOfDataForGnuplot) {
        g_gnuplot.putFile(k, g_mapOfDataForGnuplot[k]);
    }

    g_gnuplot.run(editor.value, function(e) {
        try {
            g_gnuplot.onOutput('Plotting took ' + (Date.now() - start) / 1000 + 's.');
            g_gnuplot.getFile('out.svg', function(e) {
                if (!e.content) {
                    g_gnuplot.onError("Output file out.svg not found!");
                    return;
                }
                var img = document.getElementById('gnuplot-img');
                try {
                    var ab = new Uint8Array(e.content);
                    var blob = new Blob([ab], {"type": "image\/svg+xml"});
                    window.URL = window.URL || window.webkitURL;
                    img.src = window.URL.createObjectURL(blob);
                } catch (err) { // in case blob / URL missing, fallback to data-uri
                    if (!window.blobalert) {
                        alert('Warning - your browser does not support Blob-URLs, using data-uri with a lot more memory and time required. Err: ' + err);
                        window.blobalert = true;
                    }
                    var rstr = '';
                    for (var i = 0; i < e.content.length; i++)
                        rstr += String.fromCharCode(e.content[i]);
                    img.src = 'data:image\/svg+xml;base64,' + btoa(rstr);
                }
            });
        }
        catch (err) {}
    });
}

////////////////////////////////////////////////////////////////////////////////
function setupPointCloudView() {
    var scene = new THREE.Scene();

    var renderer = new THREE.WebGLRenderer();
    renderer.setSize(400, 286);
    renderer.setClearColor(new THREE.Color(0xaaaaaa));
    document.getElementById('ego-3dview').appendChild(renderer.domElement);
    document.getElementById('ego-3dview').style.visibility = "hidden";

    var camera = new THREE.PerspectiveCamera( 75, window.innerWidth/window.innerHeight, 0.1, 1000 );
    camera.position.y = 5;
    camera.position.z = 5;
    camera.lookAt (new THREE.Vector3(0, 0, 0));
    scene.add (camera);


    var controls = new THREE.OrbitControls(camera, renderer.domElement);


    var pointLight = new THREE.PointLight(0xffffff);
    pointLight.position.set (0, 20, 20);
    scene.add (pointLight);
    
    var ambientLight = new THREE.AmbientLight (0xaaaaaa);
    scene.add(ambientLight);


    var gridXZ = new THREE.GridHelper(50, 50, 0xff0000, 0xffffff);
    scene.add(gridXZ);

    // Point Cloud for RPlidar:
    {
        var pointMaterial = new THREE.PointsMaterial({
            size: 0.02,
            opacity: 1,
            vertexColors: THREE.VertexColors
        });

        var geometry_pointcloud_rplidar = new THREE.BufferGeometry();

        var positions_rplidar = new Float32Array(MAX_POINTS_rplidar * 3); // 3 vertices per point
        positions_rplidar.fill(0);
        geometry_pointcloud_rplidar.addAttribute('position', new THREE.BufferAttribute(positions_rplidar, 3));

        var colors_rplidar = new Float32Array(MAX_POINTS_rplidar * 3); // RGB per point
        colors_rplidar.fill(0);
        geometry_pointcloud_rplidar.addAttribute('color', new THREE.BufferAttribute(colors_rplidar, 3));

        g_particles_pointcloud_rplidar = new THREE.Points(geometry_pointcloud_rplidar, pointMaterial);
        scene.add(g_particles_pointcloud_rplidar);
    }

    // Point Cloud for VLP16:
    {
        var pointMaterial = new THREE.PointsMaterial({
            size: 0.02,
            opacity: 1,
            vertexColors: THREE.VertexColors
        });

        var geometry_pointcloud_vlp16 = new THREE.BufferGeometry();

        var positions_vlp16 = new Float32Array(MAX_POINTS_vlp16 * 3); // 3 vertices per point
        positions_vlp16.fill(0);
        geometry_pointcloud_vlp16.addAttribute('position', new THREE.BufferAttribute(positions_vlp16, 3));

        var colors_vlp16 = new Float32Array(MAX_POINTS_vlp16 * 3); // RGB per point
        colors_vlp16.fill(0);
        geometry_pointcloud_vlp16.addAttribute('color', new THREE.BufferAttribute(colors_vlp16, 3));

        g_particles_pointcloud_vlp16 = new THREE.Points(geometry_pointcloud_vlp16, pointMaterial);
        scene.add(g_particles_pointcloud_vlp16);
    }

    // Point Cloud for HDL32e_12 layers:
    {
        var pointMaterial = new THREE.PointsMaterial({
            size: 0.02,
            opacity: 1,
            vertexColors: THREE.VertexColors
        });

        var geometry_pointcloud_hdl32e_12 = new THREE.BufferGeometry();
        var positions_hdl32e_12 = new Float32Array(MAX_POINTS_hdl32e_12 * 3); // 3 vertices per point
        positions_hdl32e_12.fill(0);
        geometry_pointcloud_hdl32e_12.addAttribute('position', new THREE.BufferAttribute(positions_hdl32e_12, 3));

        var colors_hdl32e_12 = new Float32Array(MAX_POINTS_hdl32e_12 * 3); // RGB per point
        colors_hdl32e_12.fill(0);
        geometry_pointcloud_hdl32e_12.addAttribute('color', new THREE.BufferAttribute(colors_hdl32e_12, 3));

        g_particles_pointcloud_hdl32e_12 = new THREE.Points(geometry_pointcloud_hdl32e_12, pointMaterial);
        scene.add(g_particles_pointcloud_hdl32e_12);
    }

    // Point Cloud for HDL32e_11 layers:
    {
        var pointMaterial = new THREE.PointsMaterial({
            size: 0.02,
            opacity: 1,
            vertexColors: THREE.VertexColors
        });

        var geometry_pointcloud_hdl32e_11 = new THREE.BufferGeometry();
        var positions_hdl32e_11 = new Float32Array(MAX_POINTS_hdl32e_11 * 3); // 3 vertices per point
        positions_hdl32e_11.fill(0);
        geometry_pointcloud_hdl32e_11.addAttribute('position', new THREE.BufferAttribute(positions_hdl32e_11, 3));

        var colors_hdl32e_11 = new Float32Array(MAX_POINTS_hdl32e_11 * 3); // RGB per point
        colors_hdl32e_11.fill(0);
        geometry_pointcloud_hdl32e_11.addAttribute('color', new THREE.BufferAttribute(colors_hdl32e_11, 3));

        g_particles_pointcloud_hdl32e_11 = new THREE.Points(geometry_pointcloud_hdl32e_11, pointMaterial);
        scene.add(g_particles_pointcloud_hdl32e_11);
    }

    // Point Cloud for HDL32e_9 layers:
    {
        var pointMaterial = new THREE.PointsMaterial({
            size: 0.02,
            opacity: 1,
            vertexColors: THREE.VertexColors
        });

        var geometry_pointcloud_hdl32e_9 = new THREE.BufferGeometry();
        var positions_hdl32e_9 = new Float32Array(MAX_POINTS_hdl32e_9 * 3); // 3 vertices per point
        positions_hdl32e_9.fill(0);
        geometry_pointcloud_hdl32e_9.addAttribute('position', new THREE.BufferAttribute(positions_hdl32e_9, 3));

        var colors_hdl32e_9 = new Float32Array(MAX_POINTS_hdl32e_9 * 3); // RGB per point
        colors_hdl32e_9.fill(0);
        geometry_pointcloud_hdl32e_9.addAttribute('color', new THREE.BufferAttribute(colors_hdl32e_9, 3));

        g_particles_pointcloud_hdl32e_9 = new THREE.Points(geometry_pointcloud_hdl32e_9, pointMaterial);
        scene.add(g_particles_pointcloud_hdl32e_9);
    }

    var animate = function () {
        requestAnimationFrame( animate );
        renderer.render(scene, camera);
    };

    animate();
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

