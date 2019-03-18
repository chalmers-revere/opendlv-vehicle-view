## OpenDLV Microservice to view vehicle onboard data in your web-browser

This repository provides source code to view selected vehicle onboard data like
GPS position and point clouds that are exchanged in a running session using
the OpenDLV software ecosystem. The best performance is experienced using
Chrome or Firefox.

[![License: GPLv3](https://img.shields.io/badge/license-GPL--3-blue.svg
)](https://www.gnu.org/licenses/gpl-3.0.txt)


## Table of Contents
* [Dependencies](#dependencies)
* [Usage](#usage)
* [License](#license)


## Dependencies
No dependencies! The following dependencies are part of the source distribution:

* [font-awesome.css 5.1.0](https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.1.0/css/font-awesome.min.css)
* [maptalks.css](https://unpkg.com/maptalks/dist/maptalks.css)
* [maptalks](https://unpkg.com/maptalks/dist/maptalks.min.js)
* [three 88](https://cdnjs.cloudflare.com/ajax/libs/three.js/88/three.min.js)
* [gauge 2.1.4](https://cdn.rawgit.com/Mikhus/canvas-gauges/gh-pages/download/2.1.4/all/gauge.min.js)
* [libcluon.js 0.0.121](https://github.com/chrberger/libcluon) - [![License](https://img.shields.io/badge/License-BSD%203--Clause-blue.svg)](https://opensource.org/licenses/BSD-3-Clause)
* [mini-decoder.js](https://github.com/chrberger/mini-decoder.js)


## Usage
This microservice is created automatically on changes to this repository via
Docker's public registry for:
* [x86_64](https://hub.docker.com/r/chalmersrevere/opendlv-vehicle-view-amd64/tags/)
* [armhf](https://hub.docker.com/r/chalmersrevere/opendlv-vehicle-view-armhf/tags/)

To use this microservice for viewing selected vehicle onboard messages from the
OpenDLV Standard Message Set that are exchanged in a running OpenDLV.io session
(running at 111 in the example), simply run it as follows:

```
docker run --rm --init --net=host --name=opendlv-vehicle-view -v ~/recordings:/opt/vehicle-view/recordings -v /var/run/docker.sock:/var/run/docker.sock -p 8081:8081 chalmersrevere/opendlv-vehicle-view-multi:v0.0.60
```

Now, simply point your web-browser to the IP address and port 8081 where you
started this microservice to see any currently exchanged messages:

![screenshot from vehicle view](https://raw.githubusercontent.com/chalmers-revere/opendlv-vehicle-view/master/vehicle-view-animated.gif)


## License

* This project is released under the terms of the GNU GPLv3 License

