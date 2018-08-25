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

FROM arm32v7/ubuntu:18.04 as builder
MAINTAINER Christian Berger "christian.berger@gu.se"

# Set the env variable DEBIAN_FRONTEND to noninteractive
ENV DEBIAN_FRONTEND noninteractive

ENV QEMU_EXECVE 1
COPY ./cross-build/cross-build-start /usr/bin/cross-build-start
COPY ./cross-build/cross-build-end /usr/bin/cross-build-end
COPY ./cross-build/qemu-arm-static /usr/bin/qemu-arm-static
COPY ./cross-build/sh-shim /usr/bin/sh-shim

RUN ["cross-build-start"]

RUN apt-get update -y && \
    apt-get upgrade -y && \
    apt-get dist-upgrade -y && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        cmake \
        build-essential

ADD . /opt/sources
WORKDIR /opt/sources
RUN mkdir /opt/sources/build.1 && cd /opt/sources/build.1 && cmake ../src && make && cp rec-metadataToJSON /tmp

RUN ["cross-build-end"]


FROM arm32v7/ubuntu:18.04
MAINTAINER Christian Berger "christian.berger@gu.se"

# Set the env variable DEBIAN_FRONTEND to noninteractive
ENV DEBIAN_FRONTEND noninteractive

ENV QEMU_EXECVE 1
COPY ./cross-build/cross-build-start /usr/bin/cross-build-start
COPY ./cross-build/cross-build-end /usr/bin/cross-build-end
COPY ./cross-build/qemu-arm-static /usr/bin/qemu-arm-static
COPY ./cross-build/sh-shim /usr/bin/sh-shim

RUN ["cross-build-start"]

RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
        software-properties-common && \
    add-apt-repository ppa:chrberger/libcluon && \
    apt-get update -y && \
    apt-get upgrade -y && \
    apt-get dist-upgrade -y && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        libcluon \
        nodejs \
        npm \
        zip && \
    apt-get clean

# Download Docker for armhf.
RUN mkdir -p /tmp/download && \
    curl -L https://download.docker.com/linux/static/stable/armhf/docker-18.06.0-ce.tgz | tar -xz -C /tmp/download && \
    mv /tmp/download/docker/docker /usr/bin/ && \
    rm -rf /tmp/download

# Install rec-metadataToJSON from builder image.
COPY --from=builder /tmp/rec-metadataToJSON /usr/bin

# Setup application folder.
RUN mkdir -p /opt/vehicle-view/recordings
WORKDIR /opt/vehicle-view
COPY webapp/ .
RUN mv package.json.armhf package.json && \
    rm -f package.json.amd64 && \
    mv index.js.armhf index.js && \
    rm -f index.js.amd64 && \
    npm install

RUN ["cross-build-end"]

EXPOSE 8081
CMD ["node", "index.js"]

