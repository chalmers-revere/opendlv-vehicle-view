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

#include <ctime>

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

                    std::stringstream sstrKey;
                    sstrKey << env.dataType() << "/" << env.senderStamp();
                    const std::string KEY = sstrKey.str();
                    numberOfMessagesPerType[KEY]++;
                }
            }

            time_t firstSampleTime = timeStampFromFirstEnvelope.seconds();
            std::string strFirstSampleTime(::ctime(&firstSampleTime));
            strFirstSampleTime = strFirstSampleTime.substr(0, strFirstSampleTime.size()-1);
            strFirstSampleTime = stringtoolbox::trim(strFirstSampleTime);

            time_t lastSampleTime = timeStampFromLastEnvelope.seconds();
            std::string strLastSampleTime(::ctime(&lastSampleTime));
            strLastSampleTime = strLastSampleTime.substr(0, strLastSampleTime.size()-1);
            strLastSampleTime = stringtoolbox::trim(strLastSampleTime);
            std::cout << "{ \"attributes\": [ "
                      << "{ \"key\": \"number of messages:\", \"value\":\"" << numberOfEnvelopes << "\"}"
                      << ",{ \"key\": \"start of recording:\", \"value\":\"" << strFirstSampleTime << "\"}"
                      << ",{ \"key\": \"end of recording:\", \"value\":\"" << strLastSampleTime << "\"}";

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
                std::cout << ",{ \"key\": \"" << (scope.count(messageID) > 0 ? scope[messageID].messageName() : "unknown message") << "\", \"value\":\"" << e.second << "\", \"selectable\":true, \"messageID\":" << messageID << ", \"senderStamp\":" << senderStamp << "}";
            }

            std::cout << " ] }" << std::endl;
        }
        else {
            std::cerr << argv[0] << ": Recording '" << commandlineArguments["rec"] << "' not found." << std::endl;
        }
    }
    return retCode;
}

