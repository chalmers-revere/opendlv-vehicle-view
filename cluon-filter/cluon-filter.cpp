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

#include <map>
#include <string>

int32_t main(int32_t argc, char **argv) {
    int32_t retCode{0};
    auto commandlineArguments = cluon::getCommandlineArguments(argc, argv);
    if (0 == commandlineArguments.count("keep")) {
        std::cerr << argv[0] << " filters Envelopes from stdin to stdout." << std::endl;
        std::cerr << "Usage:   " << argv[0] << " --keep=<list of messageID/senderStamp pairs to keep>" << std::endl;
        std::cerr << "Example: " << argv[0] << " --keep=19/0,25/1" << std::endl;
        retCode = 1;
    } else {
        std::map<std::string, bool> mapOfEnvelopesToKeep{};
        std::string tmp{commandlineArguments["keep"]};
        tmp += ",";
        auto entries = stringtoolbox::split(tmp, ',');
        for (auto e : entries) {
            auto l = stringtoolbox::split(e, '/');
            std::string toKeep{e};
            if (0 == l.size()) {
                toKeep += "/0";
            }
            std::cerr << argv[0] << " keeping " << toKeep << std::endl;
            mapOfEnvelopesToKeep[toKeep] = true;
        }
        bool foundData{false};
        do {
            auto retVal = cluon::extractEnvelope(std::cin);
            foundData = retVal.first;
            if (0 < retVal.second.dataType()) {
                std::stringstream sstr;
                sstr << retVal.second.dataType() << "/" << retVal.second.senderStamp();
                std::string str = sstr.str();
                if (mapOfEnvelopesToKeep.count(str)) {
                    str = cluon::serializeEnvelope(std::move(retVal.second));
                    std::cout << str;
                    std::cout.flush();
                }
            }
        } while (std::cin.good() && foundData);
    }
    return retCode;
}

