"use strict";

const utils = require("./utils");
const fs = require("fs");

let globalOptions = {};
let ctx = null;
let _defaultFuncs = null;
let api = null;
let region;

const errorRetrieving =
  "Error retrieving userID. This can be caused by a lot of things, including getting blocked by Facebook for logging in from an unknown location. Try logging in with a browser to verify.";

async function setOptions(globalOptions_from, options = {}) {
  Object.keys(options).map((key) => {
    switch (key) {
      case "online":
        globalOptions_from.online = Boolean(options.online);
        break;
      case "selfListen":
        globalOptions_from.selfListen = Boolean(options.selfListen);
        break;
      case "selfListenEvent":
        globalOptions_from.selfListenEvent = options.selfListenEvent;
        break;
      case "listenEvents":
        globalOptions_from.listenEvents = Boolean(options.listenEvents);
        break;
      case "pageID":
        globalOptions_from.pageID = options.pageID.toString();
        break;
      case "updatePresence":
        globalOptions_from.updatePresence = Boolean(options.updatePresence);
        break;
      case "forceLogin":
        globalOptions_from.forceLogin = Boolean(options.forceLogin);
        break;
      case "userAgent":
        globalOptions_from.userAgent = options.userAgent;
        break;
      case "autoMarkDelivery":
        globalOptions_from.autoMarkDelivery = Boolean(options.autoMarkDelivery);
        break;
      case "autoMarkRead":
        globalOptions_from.autoMarkRead = Boolean(options.autoMarkRead);
        break;
      case "listenTyping":
        globalOptions_from.listenTyping = Boolean(options.listenTyping);
        break;
      case "proxy":
        if (typeof options.proxy != "string") {
          delete globalOptions_from.proxy;
          utils.setProxy();
        } else {
          globalOptions_from.proxy = options.proxy;
          utils.setProxy(globalOptions_from.proxy);
        }
        break;
      case "autoReconnect":
        globalOptions_from.autoReconnect = Boolean(options.autoReconnect);
        break;
      case "emitReady":
        globalOptions_from.emitReady = Boolean(options.emitReady);
        break;
      default:
        break;
    }
  });
  globalOptions = globalOptions_from;
}

let isBehavior = false;
async function bypassAutoBehavior(resp, jar, appstate, ID) {
  try {
    const appstateCUser =
      appstate.find((i) => i.key == "c_user") ||
      appstate.find((i) => i.key == "i_user");
    const UID = ID || appstateCUser.value;
    const FormBypass = {
      av: UID,
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: "FBScrapingWarningMutation",
      variables: JSON.stringify({}),
      server_timestamps: true,
      doc_id: 6339492849481770,
    };
    const reconnect = () => {
      console.warn(
        `We suspect automated behavior on account ${UID}. Some accounts might experience auto logout, and you need to resubmit your appstate again every automated behavior detection.`,
      );
      if (!isBehavior) isBehavior = true;
    };
    if (resp) {
      if (
        resp.request.uri &&
        resp.request.uri.href.includes("https://www.facebook.com/checkpoint/")
      ) {
        if (resp.request.uri.href.includes("601051028565049")) {
          const fb_dtsg = utils.getFrom(
            resp.body,
            '["DTSGInitData",[],{"token":"',
            '","',
          );
          const jazoest = utils.getFrom(resp.body, "jazoest=", '",');
          const lsd = utils.getFrom(resp.body, '["LSD",[],{"token":"', '"}');
          return utils
            .post(
              "https://www.facebook.com/api/graphql/",
              jar,
              {
                ...FormBypass,
                fb_dtsg,
                jazoest,
                lsd,
              },
              globalOptions,
            )
            .then(utils.saveCookies(jar))
            .then((res) => {
              reconnect();
              return res;
            });
        } else return resp;
      } else return resp;
    }
  } catch (e) {
    console.error(e);
  }
}

function buildAPI(html, jar) {
  let fb_dtsg;
  let userID;
  const tokenMatch = html.match(/DTSGInitialData.*?token":"(.*?)"/);
  if (tokenMatch) {
    fb_dtsg = tokenMatch[1];
  }

  let cookie = jar.getCookies("https://www.facebook.com");
  let primary_profile = cookie.filter(function (val) {
    return val.cookieString().split("=")[0] === "c_user";
  });
  let secondary_profile = cookie.filter(function (val) {
    return val.cookieString().split("=")[0] === "i_user";
  });
  if (primary_profile.length === 0 && secondary_profile.length === 0) {
    throw {
      error: errorRetrieving,
    };
  } else {
    if (html.indexOf("/checkpoint/block/?next") > -1) {
      return console.warn(
        "Checkpoint detected. Please log in with a browser to verify.",
      );
    }
    if (
      secondary_profile[0] &&
      secondary_profile[0].cookieString().includes("i_user")
    ) {
      userID = secondary_profile[0].cookieString().split("=")[1].toString();
    } else {
      userID = primary_profile[0].cookieString().split("=")[1].toString();
    }
  }

  const clientID = ((Math.random() * 2147483648) | 0).toString(16);
  const CHECK_MQTT = {
    oldFBMQTTMatch: html.match(
      /irisSeqID:"(.+?)",appID:219994525426954,endpoint:"(.+?)"/,
    ),
    newFBMQTTMatch: html.match(
      /{"app_id":"219994525426954","endpoint":"(.+?)","iris_seq_id":"(.+?)"}/,
    ),
    legacyFBMQTTMatch: html.match(
      /\["MqttWebConfig",\[\],{"fbid":"(.*?)","appID":219994525426954,"endpoint":"(.*?)","pollingEndpoint":"(.*?)"/,
    ),
  };
  let Slot = Object.keys(CHECK_MQTT);
  let mqttEndpoint, irisSeqID;
  Object.keys(CHECK_MQTT).map((MQTT) => {
    if (globalOptions.bypassRegion) return;
    if (CHECK_MQTT[MQTT] && !region) {
      switch (Slot.indexOf(MQTT)) {
        case 0: {
          irisSeqID = CHECK_MQTT[MQTT][1];
          mqttEndpoint = CHECK_MQTT[MQTT][2].replace(/\\\//g, "/");
          region = new URL(mqttEndpoint).searchParams
            .get("region")
            .toUpperCase();
          break;
        }
        case 1: {
          irisSeqID = CHECK_MQTT[MQTT][2];
          mqttEndpoint = CHECK_MQTT[MQTT][1].replace(/\\\//g, "/");
          region = new URL(mqttEndpoint).searchParams
            .get("region")
            .toUpperCase();
          break;
        }
        case 2: {
          mqttEndpoint = CHECK_MQTT[MQTT][2].replace(/\\\//g, "/");
          region = new URL(mqttEndpoint).searchParams
            .get("region")
            .toUpperCase();
          break;
        }
      }
      return;
    }
  });
  if (!region)
    region = ["prn", "pnb", "vll", "hkg", "sin", "ftw", "ash"][
      (Math.random() * 5) | 0
    ].toUpperCase();
  if (!mqttEndpoint)
    mqttEndpoint = "wss://edge-chat.facebook.com/chat?region=" + region;
  
  let ctx = {
    userID,
    jar,
    clientID,
    globalOptions,
    loggedIn: true,
    access_token: "NONE",
    clientMutationId: 0,
    mqttClient: undefined,
    lastSeqId: irisSeqID,
    syncToken: undefined,
    mqttEndpoint,
    wsReqNumber: 0,
    wsTaskNumber: 0,
    reqCallbacks: {},
    callback_Task: {},
    region,
    firstListen: true,
    fb_dtsg,
  };

  let defaultFuncs = utils.makeDefaults(html, userID, ctx);
  return [ctx, defaultFuncs];
}

async function loginHelper(appState, custom = {}, callback) {
  let mainPromise = null;
  const jar = utils.getJar();
  if (appState) {
    if (utils.getType(appState) === "Array" && appState.some((c) => c.name)) {
      appState = appState.map((c) => {
        c.key = c.name;
        delete c.name;
        return c;
      });
    } else if (utils.getType(appState) === "String") {
      const arrayAppState = [];
      appState.split(";").forEach((c) => {
        const [key, value] = c.split("=");
        arrayAppState.push({
          key: (key || "").trim(),
          value: (value || "").trim(),
          domain: ".facebook.com",
          path: "/",
          expires: new Date().getTime() + 1000 * 60 * 60 * 24 * 365,
        });
      });
      appState = arrayAppState;
    }

    appState.map((c) => {
      const str =
        c.key +
        "=" +
        c.value +
        "; expires=" +
        c.expires +
        "; domain=" +
        c.domain +
        "; path=" +
        c.path +
        ";";
      jar.setCookie(str, "http://" + c.domain);
    });

    mainPromise = utils
      .get("https://www.facebook.com/", jar, null, globalOptions, {
        noRef: true,
      })
      .then(utils.saveCookies(jar));
     } else {
    return console.log("Please provide an appstate.");
  }

  api = {
    setOptions: setOptions.bind(null, globalOptions),
    getAppState() {
      const appState = utils.getAppState(jar);
      if (!Array.isArray(appState)) return [];
      const uniqueAppState = appState.filter((item, index, self) => {
        return self.findIndex((t) => t.key === item.key) === index;
      });
      return uniqueAppState.length > 0 ? uniqueAppState : appState;
    },
  };
  mainPromise = mainPromise
    .then((res) => bypassAutoBehavior(res, jar, appState))
    .then(async (res) => {
      const resp = await utils.get(
        `https://www.facebook.com/home.php`,
        jar,
        null,
        globalOptions,
      );
      const html = resp?.body;
      const stuff = await buildAPI(html, jar);
      ctx = stuff[0];
      _defaultFuncs = stuff[1];
      api.addFunctions = (directory) => {
        const folder = directory.endsWith("/") ? directory : directory + "/";
        fs.readdirSync(folder)
          .filter((v) => v.endsWith(".js"))
          .map((v) => {
            api[v.replace(".js", "")] = require(folder + v)(
              _defaultFuncs,
              api,
              ctx,
            );
          });
      };
      api.addFunctions(__dirname + "/src");
      api.listen = api.listenMqtt;
      api.reconnect = { ...custom };

      console.log(`Account's message region: ${region}`);
      return res;
    });
  if (globalOptions.pageID) {
    mainPromise = mainPromise
      .then(function () {
        return utils.get(
          "https://www.facebook.com/" +
            ctx.globalOptions.pageID +
            "/messages/?section=messages&subsection=inbox",
          ctx.jar,
          null,
          globalOptions,
        );
      })
      .then(function (resData) {
        let url = utils
          .getFrom(
            resData.body,
            'window.location.replace("https:\\/\\/www.facebook.com\\',
            '");',
          )
          .split("\\")
          .join("");
        url = url.substring(0, url.length - 1);
        return utils.get(
          "https://www.facebook.com" + url,
          ctx.jar,
          null,
          globalOptions,
        );
      });
  }

  mainPromise
    .then(() => {
      console.log("Done logging in.");
      return callback(null, api);
    })
    .catch((e) => {
      callback(e);
    });
}

async function login(loginData, options, callback) {
  if (
    utils.getType(options) === "Function" ||
    utils.getType(options) === "AsyncFunction"
  ) {
    callback = options;
    options = {};
  }
  const globalOptions = {
    selfListen: false,
    selfListenEvent: false,
    listenEvents: true,
    listenTyping: false,
    updatePresence: false,
    forceLogin: false,
    autoMarkDelivery: false,
    autoMarkRead: true,
    autoReconnect: true,
    online: true,
    emitReady: false,
    userAgent: "www.facebook.com/externalhit_uatext.php",
  };
  if (options) Object.assign(globalOptions, options);
  const login = () => {
    loginHelper(
      loginData?.appState,
      {
        relogin() {
          login();
        },
      },
      (loginError, loginApi) => {
        if (loginError) {
          if (isBehavior) {
            console.warn(
              "Failed after dismiss behavior, will relogin automatically...",
            );
            isBehavior = false;
            login();
          }
          console.error("Login error:", loginError);
          return callback(loginError);
        }
        callback(null, loginApi);
      },
    );
  };
  setOptions(globalOptions, options).then((_) => login());
  return;
}

module.exports = login;