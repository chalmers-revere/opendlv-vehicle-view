# Copyright (C) 2018  Christian Berger
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

FROM chrberger/cluon-armhf:latest as builder
MAINTAINER Christian Berger "christian.berger@gu.se"

RUN [ "cross-build-start" ]

RUN apk update && \
    apk --no-cache add \
        cmake \
        make \
        g++
ADD . /opt/sources
WORKDIR /opt/sources
RUN mkdir /opt/sources/build.1 && cd /opt/sources/build.1 && cmake ../src && make && cp rec-metadataToJSON /tmp

RUN [ "cross-build-end" ]


FROM chrberger/cluon-armhf:latest
MAINTAINER Christian Berger "christian.berger@gu.se"

RUN [ "cross-build-start" ]

RUN echo http://dl-4.alpinelinux.org/alpine/edge/main > /etc/apk/repositories && \
    echo http://dl-4.alpinelinux.org/alpine/edge/community >> /etc/apk/repositories

RUN apk update && \
    apk --no-cache add \
        curl \
        git \
        nodejs \
        npm \
        zip
RUN mkdir -p /tmp/download && \
    curl -L https://download.docker.com/linux/static/stable/armhf/docker-18.06.0-ce.tgz | tar -xz -C /tmp/download && \
    mv /tmp/download/docker/docker /usr/bin/ && \
    rm -rf /tmp/download && \
    apk del curl && \
    rm -rf /var/cache/apk/*

COPY --from=builder /tmp/rec-metadataToJSON /usr/bin

RUN mkdir -p /opt/vehicle-view/recordings

WORKDIR /opt/vehicle-view
RUN npm install body-parser express express-handlebars fs ps-tree ws --save --production

RUN [ "cross-build-end" ]

COPY webapp/ .

EXPOSE 8081
CMD ["node", "index.js"]

