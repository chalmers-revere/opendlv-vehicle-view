/*
 * Copyright (c) 2018 - Christian Berger <christian.berger@gu.se>
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */

// Include the single-file, header-only cluon library.
#include "cluon-complete.hpp"
#include "WGS84toCartesian.hpp"
#include "opendlv-standard-message-set.hpp"

#include <ctime>
#include <cmath>
#include <iomanip>

int32_t main(int32_t argc, char **argv) {
    int32_t retCode{0};
    auto commandlineArguments = cluon::getCommandlineArguments(argc, argv);
    if ( (0 == commandlineArguments.count("rec")) || (0 == commandlineArguments.count("odvd")) ) {
        std::cerr << argv[0] << " extracts meta information from a given .rec file using a provided .odvd message specification as a JSON object to stdout." << std::endl;
        std::cerr << "Usage:   " << argv[0] << " --rec=<Recording from an OD4Session> --odvd=<ODVD Message Specification>" << std::endl;
        std::cerr << "Example: " << argv[0] << " --rec=myRecording.rec --odvd=myMessage" << std::endl;
        retCode = 1;
    } else {
        cluon::MessageParser mp;
        std::pair<std::vector<cluon::MetaMessage>, cluon::MessageParser::MessageParserErrorCodes> messageParserResult;
        {
            std::ifstream fin(commandlineArguments["odvd"], std::ios::in|std::ios::binary);
            if (fin.good()) {
                std::string input(static_cast<std::stringstream const&>(std::stringstream() << fin.rdbuf()).str()); // NOLINT
                fin.close();
                messageParserResult = mp.parse(input);
                std::clog << "Found " << messageParserResult.first.size() << " messages." << std::endl;
            }
            else {
                std::cerr << argv[0] << ": Message specification '" << commandlineArguments["odvd"] << "' not found." << std::endl;
                return retCode;
            }
        }

        std::fstream fin(commandlineArguments["rec"], std::ios::in|std::ios::binary);
        if (fin.good()) {
            fin.close();

            std::map<int32_t, cluon::MetaMessage> scope;
            for (const auto &e : messageParserResult.first) { scope[e.messageIdentifier()] = e; }

            constexpr bool AUTOREWIND{false};
            constexpr bool THREADING{false};
            cluon::Player player(commandlineArguments["rec"], AUTOREWIND, THREADING);

            uint32_t numberOfEnvelopes{0};

            std::map<std::string, uint32_t> numberOfMessagesPerType{};
            std::vector<cluon::data::Envelope> envelopesWithOpendlvSystemLogMessage{};
            std::vector<cluon::data::Envelope> envelopesWithOpendlvProxyGeodeticWgs84Reading{};

            bool timeStampFromFirstEnvelopeSet{false};
            cluon::data::TimeStamp timeStampFromFirstEnvelope;
            cluon::data::TimeStamp timeStampFromLastEnvelope;
            while (player.hasMoreData()) {
                auto next = player.getNextEnvelopeToBeReplayed();
                if (next.first) {
                    cluon::data::Envelope env{std::move(next.second)};
                    if (!timeStampFromFirstEnvelopeSet) {
                        timeStampFromFirstEnvelope = env.sampleTimeStamp();
                        timeStampFromFirstEnvelopeSet = true;
                    }
                    timeStampFromLastEnvelope = env.sampleTimeStamp();
                    numberOfEnvelopes++;

                    // Count types.
                    {
                        std::stringstream sstrKey;
                        sstrKey << env.dataType() << "/" << env.senderStamp();
                        const std::string KEY = sstrKey.str();
                        numberOfMessagesPerType[KEY]++;
                    }
                    // Store opendlv.system.LogMessage.
                    if ( (env.dataType() == opendlv::system::LogMessage::ID()) &&
                         (env.senderStamp() == 999) ) {
                        envelopesWithOpendlvSystemLogMessage.push_back(env);
                    }
                    // Store opendlv.proxy.GeodeticWgs84Reading.
                    if ( (env.dataType() == opendlv::proxy::GeodeticWgs84Reading::ID()) &&
                         (env.senderStamp() == 0) ) {
                        envelopesWithOpendlvProxyGeodeticWgs84Reading.push_back(env);
                    }

                }
            }

            char dateTimeBuffer[26];
            time_t firstSampleTime = timeStampFromFirstEnvelope.seconds();
            ::ctime_r(&firstSampleTime, dateTimeBuffer);
            std::string strFirstSampleTime(dateTimeBuffer);
            strFirstSampleTime = strFirstSampleTime.substr(0, strFirstSampleTime.size()-1);
            strFirstSampleTime = stringtoolbox::trim(strFirstSampleTime);

            time_t lastSampleTime = timeStampFromLastEnvelope.seconds();
            ::ctime_r(&lastSampleTime, dateTimeBuffer);
            std::string strLastSampleTime(dateTimeBuffer);
            strLastSampleTime = strLastSampleTime.substr(0, strLastSampleTime.size()-1);
            strLastSampleTime = stringtoolbox::trim(strLastSampleTime);
            std::cout << "{ \"messages\": [ " << std::endl;
            // List message counters per type/sender-stamp.
            {
              uint32_t counter{0};
              for (auto e : numberOfMessagesPerType) {
                  int32_t messageID{0};
                  {
                      std::string tmp{stringtoolbox::split(e.first, '/').at(0)};
                      std::stringstream sstr(tmp);
                      sstr >> messageID;
                  }
                  int32_t senderStamp{0};
                  {
                      std::string tmp{stringtoolbox::split(e.first, '/').at(1)};
                      std::stringstream sstr(tmp);
                      sstr >> senderStamp;
                  }
                  std::cout << ((counter > 0) ? "," : "") << "{ \"key\": \"" << (scope.count(messageID) > 0 ? scope[messageID].messageName() : "unknown message") << "\", \"value\":\"" << e.second << "\", \"selectable\":true, \"messageID\":" << messageID << ", \"senderStamp\":" << senderStamp << "}" << std::endl;
                  counter++;
              }
            }
            std::cout << " ] ," << std::endl
                      << " \"comments\": [ " << std::endl;
            // Export opendlv.system.LogMessage.
            {
                uint32_t counter{0};
                for (auto e : envelopesWithOpendlvSystemLogMessage) {
                    if ( (e.dataType() == opendlv::system::LogMessage::ID()) &&
                         (e.senderStamp() == 999) ) {
                        time_t logMessageSampleTime = e.sampleTimeStamp().seconds();
                        ::ctime_r(&logMessageSampleTime, dateTimeBuffer);
                        std::string strLogMessageSampleTime(dateTimeBuffer);
                        strLogMessageSampleTime = strLogMessageSampleTime.substr(0, strLogMessageSampleTime.size()-1);
                        strLogMessageSampleTime = stringtoolbox::trim(strLogMessageSampleTime);

                        opendlv::system::LogMessage logMessage = cluon::extractMessage<opendlv::system::LogMessage>(std::move(e));

                        std::cout << ((counter > 0)? "," : "") << "{ \"key\": \"" << strLogMessageSampleTime << "\", \"value\":\"" << logMessage.description() << "\", \"opendlv_system_LogMessage\":true}" << std::endl;
                        counter++;
                    }
                }
            }
            std::cout << " ] ," << std::endl
                      << " \"gpsCommentsTrace\": [ " << std::endl;
            // Export opendlv.system.LogMessage with associated GPS coordinates.
            {
                if (!envelopesWithOpendlvProxyGeodeticWgs84Reading.empty()) {
                    uint32_t counter{0};
                    std::vector<cluon::data::Envelope>::iterator closestGPS;
                    std::array<double, 2> position = {0, 0};

                    for (auto e : envelopesWithOpendlvSystemLogMessage) {
                        if ( (e.dataType() == opendlv::system::LogMessage::ID()) &&
                             (e.senderStamp() == 999) ) {
                            if (!envelopesWithOpendlvProxyGeodeticWgs84Reading.empty()) {
                                if (0 == counter) {
                                    closestGPS = envelopesWithOpendlvProxyGeodeticWgs84Reading.begin();
                                }
                                while (closestGPS != envelopesWithOpendlvProxyGeodeticWgs84Reading.end()) {
                                    auto delta = cluon::time::deltaInMicroseconds(e.sampleTimeStamp(), (*closestGPS).sampleTimeStamp());
                                    if ( (delta > 0) && (delta < static_cast<int64_t>(250*1000)) ) {
                                        cluon::data::Envelope env = *closestGPS;
                                        opendlv::proxy::GeodeticWgs84Reading pos = cluon::extractMessage<opendlv::proxy::GeodeticWgs84Reading>(std::move(env));
                                        position[0] = pos.latitude();
                                        position[1] = pos.longitude();
                                        break;
                                    }

                                    closestGPS++;
                                }
                            }
                            time_t logMessageSampleTime = e.sampleTimeStamp().seconds();
                            ::ctime_r(&logMessageSampleTime, dateTimeBuffer);
                            std::string strLogMessageSampleTime(dateTimeBuffer);
                            strLogMessageSampleTime = strLogMessageSampleTime.substr(0, strLogMessageSampleTime.size()-1);
                            strLogMessageSampleTime = stringtoolbox::trim(strLogMessageSampleTime);

                            opendlv::system::LogMessage logMessage = cluon::extractMessage<opendlv::system::LogMessage>(std::move(e));

                            std::cout << ((counter > 0)? "," : "") << "{ \"timestamp\": \"" << strLogMessageSampleTime << "\", \"comment\":\"" << logMessage.description() << "\", \"position\":{" << "\"latitude\":" << std::setprecision(10) << position[0] << std::setprecision(6) << ",\"longitude\":" << std::setprecision(10) << position[1] << std::setprecision(6)<< "} }" << std::endl;
                            counter++;
                        }
                    }
                }
            }
            std::cout << " ] ," << std::endl
                      << " \"gpsTrace\": [ " << std::endl;
            // Export opendlv.proxy.GeodeticWgs84Reading.
            {
                if (envelopesWithOpendlvProxyGeodeticWgs84Reading.size() >= 2) {
                    cluon::data::Envelope envFirst = envelopesWithOpendlvProxyGeodeticWgs84Reading.front();
                    opendlv::proxy::GeodeticWgs84Reading firstPos = cluon::extractMessage<opendlv::proxy::GeodeticWgs84Reading>(std::move(envFirst));

                    uint32_t counter{0};
                    std::array<double, 2> reference{firstPos.latitude(), firstPos.longitude()};
                    for (auto env : envelopesWithOpendlvProxyGeodeticWgs84Reading) {
                        opendlv::proxy::GeodeticWgs84Reading nextWGS84 = cluon::extractMessage<opendlv::proxy::GeodeticWgs84Reading>(std::move(env));
                        std::array<double, 2> nextPos{nextWGS84.latitude(), nextWGS84.longitude()};
                        std::array<double, 2> result{wgs84::toCartesian(reference, nextPos)};
                        double d = std::sqrt(result[0]*result[0] + result[1]*result[1]);
                        if (d > 5) {
                            reference = nextPos;
                            std::cout << ((counter > 0)? "," : "") << "{" << "\"latitude\":" << std::setprecision(10) << nextPos[0] << std::setprecision(6) << ",\"longitude\":" << std::setprecision(10) << nextPos[1] << std::setprecision(6)<< "}" << std::endl;
                            counter++;
                        }
                    }
                }
            }
            std::cout << " ] ," << std::endl
                      << " \"fileInformation\": [ " << std::endl
                      << "{ \"key\": \"number of messages:\", \"value\":\"" << numberOfEnvelopes << "\"}" << std::endl
                      << ",{ \"key\": \"start of recording:\", \"value\":\"" << strFirstSampleTime << "\"}" << std::endl
                      << ",{ \"key\": \"end of recording:\", \"value\":\"" << strLastSampleTime << "\"}" << std::endl;
            std::cout << " ]," << std::endl;
            std::cout << "\"geojson\":\"ewogICJ0eXBlIjogIkZlYXR1cmUiLAogICJnZW9tZXRyeSI6IHsKICAgICJ0eXBlIjogIlBvaW50IiwKICAgICJjb29yZGluYXRlcyI6IFsxMi4wLCA1Ny43XQogIH0sCiAgInByb3BlcnRpZXMiOiB7CiAgICAibmFtZSI6ICJEaW5hZ2F0IElzbGFuZHMiCiAgfQp9\""<< std::endl;
            {
                if (envelopesWithOpendlvProxyGeodeticWgs84Reading.size() >= 2) {
                    cluon::data::Envelope envFirst = envelopesWithOpendlvProxyGeodeticWgs84Reading.front();
                    opendlv::proxy::GeodeticWgs84Reading firstPos = cluon::extractMessage<opendlv::proxy::GeodeticWgs84Reading>(std::move(envFirst));

                    cluon::data::Envelope envLast = envelopesWithOpendlvProxyGeodeticWgs84Reading.back();
                    opendlv::proxy::GeodeticWgs84Reading lastPos = cluon::extractMessage<opendlv::proxy::GeodeticWgs84Reading>(std::move(envLast));

                    {
                        std::stringstream tmp;
                        tmp << "{" << "\"latitude\":" << std::setprecision(10) << firstPos.latitude() << std::setprecision(6) << ",\"longitude\":" << std::setprecision(10) << firstPos.longitude() << std::setprecision(6)<< "}";
                        const std::string out = cluon::ToJSONVisitor::encodeBase64(tmp.str());
                        std::cout << ",\"firstWGS84\": \"" << out << "\"" << std::endl;
                    }
                    {
                        std::stringstream tmp;
                        tmp << "{" << "\"latitude\":" << std::setprecision(10) << lastPos.latitude() << std::setprecision(6) << ",\"longitude\":" << std::setprecision(10) << lastPos.longitude() << std::setprecision(6)<< "}";
                        const std::string out = cluon::ToJSONVisitor::encodeBase64(tmp.str());
                        std::cout << ",\"lastWGS84\": \"" << out << "\"" << std::endl;
                    }
                }
            }
            std::cout << "}" << std::endl;
        }
        else {
            std::cerr << argv[0] << ": Recording '" << commandlineArguments["rec"] << "' not found." << std::endl;
        }
    }
    return retCode;
}

