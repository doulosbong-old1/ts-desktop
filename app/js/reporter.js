/**
 * Created by Emmitt on 6/26/2015.
 */

var fs = require('fs');
var os = require('os');
var https = require('https');
var mkdirp = require('mkdirp');

function Reporter (args) {
    'use strict';

    var _this = this;
    var logPath = args.logPath || './log.txt';
    var oauthToken = args.oauthToken || '';
    var repoOwner = args.repoOwner || '';
    var repo = args.repo || '';
    var maxLogFileKb = args.maxLogFileKb || 200;
    var appVersion = args.appVersion || '0.0.0';

    _this.logNotice = function (string, callback) {
        if (!string) {
            throw new Error('reporter.logNotice requires a message.');
        }
        _this.toLogFile('I', string, function () {
            if (typeof callback === 'function') {
                callback();
            }
        });
    };

    _this.logWarning = function (string, callback) {
        if (!string) {
            throw new Error('reporter.logWarning requires a message.');
        }
        _this.toLogFile('W', string, function () {
            if (typeof callback === 'function') {
                callback();
            }
        });
    };

    _this.logError = function (string, callback) {
        if (!string) {
            throw new Error('reporter.logError requires a message.');
        }
        this.toLogFile('E', string, function () {
            if (typeof callback === 'function') {
                callback();
            }
        });
    };

    _this.reportBug = function (string, callback) {
        if (!string) {
            throw new Error('reporter.reportBug requires a message.');
        }
        _this.formGithubIssue('bug report', string, null, function (res) {
            if (typeof callback === 'function') {
                callback(res);
            }
        });
    };

    _this.reportCrash = function (string, crashFilePath, callback) {
        _this.formGithubIssue('crash report', string, crashFilePath, function (res) {
            if (typeof callback === 'function') {
                callback(res);
            }
        });
    };

    _this.stackTrace = function () {
        var err = new Error();
        return err.stack;
    };

    _this.toLogFile = function (level, string, callback) {
        /* We make 3 calls before processing who called the original
         *  log command; therefore, the 4th call will be the original caller.
         * */
        var location = _this.stackTrace().split('\n')[4];
        try {
            location = location.split(/(\\|\/)/);
            location = location[location.length - 1];
            location = location.substr(0, location.length - 1);
        } catch (e) {
            throw new Error(e.message);
        }
        var date = new Date();
        date = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        var message = date + ' ' + level + '/' + location + ': ' + string + '\r\n';
        var dir = logPath.split(/\\|\//);
        dir.pop();
        dir = dir.join('\\');
        if (dir === '') {
            dir = '.';
        }
        mkdirp(dir, function (e) {
            if (e) {
                throw new Error(e);
            } else {
                fs.appendFile(logPath, message, function (err) {
                    if (err) {
                        throw new Error(err.message);
                    }
                    if (typeof callback === 'function') {
                        callback();
                    }
                });
            }
        });

        _this.truncateLogFile();
    };

    _this.stringFromLogFile = function (filePath, callback) {
        var readPath = logPath;
        if (filePath) {
            readPath = filePath;
        }
        fs.exists(readPath, function (exists) {
            if (exists) {
                fs.readFile(readPath, {encoding: 'utf8'}, function (err, data) {
                    if (err) {
                        if (typeof callback === 'function') {
                            callback('Could read log file. ERRNO: ' + err.number);
                        }
                        throw new Error(err.message);
                    }
                    if (typeof callback === 'function') {
                        callback(data);
                    }
                });
            } else {
                if (typeof callback === 'function') {
                    callback('No log file.');
                }
            }
        });
    };

    _this.truncateLogFile = function () {
        fs.stat(logPath, function (err, stats) {
            if (stats) {
                var kb = stats.size / 1024;
                if (kb >= maxLogFileKb) {
                    _this.stringFromLogFile(null, function (res) {
                        res = res.split('\n');
                        res = res.slice(res.length / 2, res.length - 1);
                        res = res.join('\n');
                        fs.unlink(logPath, function () {
                            fs.appendFile(logPath, res, function (err) {
                                if (err) {
                                    throw new Error(err.message);
                                }
                            });
                        });
                    });
                }
            }
        });
    };

    _this.formGithubIssue = function (type, string, filePath, callback) {
        var issueObject = {};
        issueObject.user = repoOwner;
        issueObject.repo = repo;
        issueObject.labels = [type, appVersion];
        if (string) {
            if (string.length > 30) {
                issueObject.title = string.substr(0, 29) + '...';
            } else {
                issueObject.title = string;
            }
        } else {
            issueObject.title = type;
        }

        var bodyBuilder = [];
        /* user notes */
        if (string) {
            bodyBuilder.push('Notes\n======');
            bodyBuilder.push(string);
        }
        /* generated notes */
        bodyBuilder.push('\nEnvironment\n======');
        bodyBuilder.push('Environment Key | Value');
        bodyBuilder.push(':--: | :--:');
        bodyBuilder.push('Version |' + appVersion);
        bodyBuilder.push('Operating System | ' + os.type());
        bodyBuilder.push('Platform | ' + os.platform());
        bodyBuilder.push('Release | ' + os.release());
        bodyBuilder.push('Architecture | ' + os.arch());
        if (type === 'crash report') {
            bodyBuilder.push('\nStack Trace\n======');
            bodyBuilder.push('```javascript');
            bodyBuilder.push(_this.stackTrace());
            bodyBuilder.push('```');
        }
        bodyBuilder.push('\nLog History\n======');
        bodyBuilder.push('```javascript');

        _this.stringFromLogFile(null, function (results) {
            if (filePath) {
                _this.stringFromLogFile(filePath, function (crashFileResults) {
                    bodyBuilder.push(results);
                    bodyBuilder.push('```');
                    bodyBuilder.push('\nCrash File\n======');
                    bodyBuilder.push('```javascript');
                    bodyBuilder.push(crashFileResults);
                    bodyBuilder.push('```');
                    issueObject.body = bodyBuilder.join('\n');
                    _this.sendIssueToGithub(issueObject, function (res) {
                        if (typeof callback === 'function') {
                            callback(res);
                        }
                    });
                });
            } else {
                bodyBuilder.push(results);
                bodyBuilder.push('```');
                issueObject.body = bodyBuilder.join('\n');
                _this.sendIssueToGithub(issueObject, function (res) {
                    if (typeof callback === 'function') {
                        callback(res);
                    }
                });
            }
        });
    };

    _this.sendIssueToGithub = function (issue, callback) {
        var params = {};
        params.title = issue.title;
        params.body = issue.body;
        params.labels = issue.labels;
        var paramsJson = JSON.stringify(params);

        var urlPath = '/repos/' + issue.user + '/' + issue.repo + '/issues';
        var postOptions = {
            host: 'api.github.com',
            port: 443,
            path: urlPath,
            method: 'POST',
            headers: {
                'User-Agent': 'ts-desktop',
                'Content-Type': 'application/json',
                'Content-Length': paramsJson.length,
                'Authorization': 'token ' + oauthToken
            }
        };

        var postReq = https.request(postOptions, function (res) {
            res.setEncoding('utf8');
            var completeData = '';
            res.on('data', function (partialData) {
                completeData += partialData;
            }).on('end', function () {
                if (typeof callback === 'function') {
                    callback(completeData);
                }
            });
        }).on('error', function (err) {
            throw new Error(err.message);
        });
        postReq.write(paramsJson);
        postReq.end();
    };

    _this.canReportToGithub = function () {
        return repo !== '' && repoOwner !== '' && oauthToken !== '';
    };
}

exports.generate = Reporter;
