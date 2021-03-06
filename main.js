// load basic packages
const process = require('process');
const fs = require('fs');
const { exec } = require('child_process');

// create temporary folder if it does not exist
if (!fs.existsSync(__dirname + "/temp")) {
    console.warn("Temporary folder does not exist! Creating...");
    fs.mkdirSync(__dirname + "/temp");
    console.log("Temporary folder created.");
}

function clearTemp() {
    exec("rm -rf " + __dirname + "/temp/*", function(err, stdout, stderr) {
        if (err) {
            console.warn("Failed to clear temp folder!");
        }
        else {
            console.log("Cleared temp folder");
        }
    });
}

// load custom packages
const postStatus = require("./poststatus.js");
postStatus.init();
const redditor = require("./redditor.js");
redditor.setPostStatus(postStatus);
const mediaDownloader = require('./mediadownloader.js');

// retrieve details needed for logging in to Instagram
const loginDetails = require('./logindetails.json');
const debugMode = loginDetails.debug != undefined && loginDetails.debug != null;

// load the Instagram Private API Client
const igPrivateApi = require('instagram-private-api');
const igClient = new igPrivateApi.IgApiClient();

// load device
// if you get the IgSentryBlockError, replace _blahblahblah with some random other string to circumvent it
igClient.state.generateDevice(loginDetails.userName + "_blahblahblah");

function doRedditStuff(loggedInUser) {
    try {
        // set subreddit
        if (!debugMode) {
            if (typeof loginDetails.subreddit == "string") {
                // only 1 subreddit has been set in logindetails.json as a string
                redditor.setSubreddit(loginDetails.subreddit);
            }
            else if (typeof loginDetails.subreddit == "object") {
                // subreddit(s) have been given as an object in logindetails.json
                // check if chances of subreddits appearing's sum == 100...
                // if this is not the case, the below function could get slow rather quickly.
                if (Object.values(loginDetails.subreddit).reduce(function(a, b) { return a + b; }, 0) == 100) {
                    // create a temporary array for later
                    let tempArray = [];
                    for (let item in loginDetails.subreddit) {
                        if (loginDetails.subreddit.hasOwnProperty(item)) {
                            // add each subreddit to the temporary array for as many times
                            // as the appearance percentage given in logindetails.json
                            for (let i = 0; i < loginDetails.subreddit[item]; i++) {
                                tempArray.push(item);
                            }
                        }
                    }
                    // select a random subreddit from the temporary array
                    redditor.setSubreddit(tempArray[Math.floor(Math.random() * tempArray.length)]);
                }
                else {
                    throw Error("Subreddit's appearance sum does not equal exactly 100");
                }
            }
            else {
                throw Error("Cannot figure out what type subreddit is in logindetails.json");
            }
        }
        else {
            redditor.setPostToDebug(loginDetails.debug);
            console.warn("Debugging mode activated");
        }
        
        // retrieve a post that is still on the to-do list
        redditor.getPostToDo().then(function(post) {
            console.log("Found a post to handle:");

            // fix broken imgur links
            if (post['data']['url'].match(/http(s|):\/\/*imgur\.com\/.......$/) != null) {
                post['data']['url'] = "https://i." + post['data']['url'].split("//")[1] + ".jpg";
            }
            
            // fix more broken links
            post['data']['url'] = post['data']['url'].replace("&amp;", "&");

            // check if post is not a selftext
            if (post['data']['selftext'] == "" || post['data']['selftext'] == null) {
                console.log("Downloading media...");
                let tempExtraCaption = "\u2063\n\u2063\nMirrored from a post on " + redditor.getSubreddit() + " by /u/" + post['data']['author'] + ": http://redd.it/" + post['data']['id'];
                mediaDownloader.downloadMedia(post).then(function(media) {
                    console.log("Media downloaded!");
                    console.log(media);
                    if (media['type'] == 'image') {
                        console.log("Uploading image to Instagram...");
                        console.log("Caption: " + post['data']['title']);
                        if (!debugMode) {
                            igClient.publish.photo({
                                file: fs.readFileSync(media['image']),
                                caption: post['data']['title'] + tempExtraCaption
                            }).then(function(publishResult) {
                                console.log(publishResult);
                                postStatus.markPostAsDone(post['data']['id']);
                                clearTemp();
                            }).catch(function(err) {
                                console.warn("Could not upload image to Instagram!");
                                console.error(err);
                                postStatus.markPostAsDone(post['data']['id']);
                                clearTemp();
                            });
                        }
                    }
                    else if (media['type'] == 'video') {
                        console.log("Uploading video to Instagram...");
                        console.log("Caption: " + post['data']['title']);
                        if (!debugMode) {
                            igClient.publish.video({
                                video: fs.readFileSync(media['video']),
                                coverImage: fs.readFileSync(media['thumbnail']),
                                caption: post['data']['title'] + tempExtraCaption
                            }).then(function(publishResult) {
                                console.log(publishResult);
                                postStatus.markPostAsDone(post['data']['id']);
                                clearTemp();
                            }).catch(function(err) {
                                console.warn("Could not upload video to Instagram!");
                                console.error(err);
                                postStatus.markPostAsDone(post['data']['id']);
                                clearTemp();
                            });
                        }
                    }
                    else {
                        console.warn("Unknown media type!");
                    }
                }).catch(function(err) {
                    console.warn("MediaDownloader failed!");
                    console.error(err);
                    postStatus.markPostAsDone(post['data']['id']);
                    clearTemp();
                });
            }
            else {
                console.warn("Selftext posts are not supported yet.");
            }
        }).catch(function(err) {
            console.warn("Failed to retrieve a post to do");
            console.error(err);
        });
    }
    catch(err) {
        console.warn("An error occurred");
        console.error(err);
    };
}

function doInstagramLogin() {
    return new Promise(function(resolve, reject) {
        // execute all requests prior to authorization in the real Android application
        igClient.simulate.preLoginFlow().then(function() {
            console.log("Logging in to " + loginDetails.username + "...");
            igClient.account.login(loginDetails.username, loginDetails.password).then(function(loggedInUser) {
                // execute all requests after authorization in the real Android application
                // we're doing this on a next tick, as per the example given in instagram-private-api's tutorial...
                process.nextTick(async function() {
                    await igClient.simulate.postLoginFlow();
                });
                console.log("Login successful!");
                resolve(loggedInUser);
            })
            .catch(function(err) {
                console.warn("Failed to sign in!");
                console.error(err);
            });
        })
        .catch(function(err) {
            console.warn("Failed to simulate pre-login flow!");
            console.error(err);
        });
    });
}

if (!debugMode) {
    doInstagramLogin().then(doRedditStuff);
}
else {
    doRedditStuff(null);
}