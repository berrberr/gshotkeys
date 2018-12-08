;(function() {
  "use strict";

  var Sitelist = require("./modules/Sitelist.js"),
      _ = require("lodash");

  /**
   * Tracks TimeoutIds by notification ID, to cancel previous uncomplete Timeouts
   * when a new notification is created prior to the last notification clearing
   */
  var notificationTimeouts = {};

  /**
   * Map from tab.id to it's status and time when it was updated
   * e.g. tabStates = {"787" : {"timestamp": <epoch>, "state": <state>}, ...}
   * Look ./modules/BaseController.js getStateData method for what is state.
   */
  var tabStates = {};

  /**
   * Send a player action to every active player tab if it's state command
   * or "stop"-like command. Otherwise command target depends on
   * "single player mode" option.
   * @param {String} command - name of the command to pass to the players
   */
  var sendAction = function(command, ...args) {
    var active_tabs = window.skSites.getActiveMusicTabs();
    active_tabs.then(function(tabs) {
      if (command === "mute" ||
          command === "stop" ||
          command === "playerStateNotify" ||
          command === "getPlayerState") {
        sendActionAllPlayers(command, tabs, args);
        return;
      }
      chrome.storage.sync.get(function(obj) {
        if (obj.hasOwnProperty("hotkey-single_player_mode") &&
            obj["hotkey-single_player_mode"]) {
          sendActionSinglePlayer(command, tabs, args);
        } else {
          sendActionAllPlayers(command, tabs, args);
        }
      });
    });
  };

  /**
   * For "single player mode": if any tabs are playing - sends
   * action to all (as it's not clear which one to prefer)
   * otherwise tries to select best tab to interact with.
   */
  var sendActionSinglePlayer = function(command, tabs, args) {
    if (_.isEmpty(tabs)) return;
    var playing = getPlayingTabs(tabs);
    if (_.isEmpty(playing)) {
      sendActionAllPlayers(command, [getBestSinglePlayerTab(tabs)], args);
    } else {
      sendActionAllPlayers(command, playing, args);
    }
  };

  /**
   * Returns "best" tab:
   * - if there is one tab is updated 200ms after all others
   * - otherwise active tab
   * - otherwise most recently updated
   */
  var getBestSinglePlayerTab = function(tabs) {
    var times = _.map(tabs, getTabUpdateTime);
    var maxTimestamp = _.max(times);
    // Pick tabs within 200ms from the most recent one.
    tabs = _.filter(tabs, function(tab) {
      return maxTimestamp - getTabUpdateTime(tab) < 200;
    });
    var sorted = _.sortBy(tabs, ["active", getTabUpdateTime]);
    return _.last(sorted);
  };

  var getTabUpdateTime = function(tab) {
    if (tabStates.hasOwnProperty(tab.id)) {
      return tabStates[tab.id].timestamp;
    }
    return 0;
  };

  /**
   * Filters out tabs that has not reported 'isPlaying' status.
   */
  var getPlayingTabs = function(tabs) {
    return _.filter(tabs, function(tab) {
      return tabStates.hasOwnProperty(tab.id) &&
        tabStates[tab.id].state.isPlaying;
    });
  };

  /**
   * Sends command to every tab in the list.
   */
  var sendActionAllPlayers = function(command, tabs, args) {
    tabs.forEach(function(tab) {
      var message = { "action": command };
      if(args != undefined) {
        message.args = args;
      }
      chrome.tabs.sendMessage(tab.id, message);
      console.log("Sent: " + command + " To: " + tab.url);
    });
  };

  /**
   * Process a command sent from somewhere (popup or content script) in the extension
   * @param {Object} request - Chrome request object from runtime.onMessage
   */
  var processCommand = function(request) {
    if(request.tab_target && parseInt(request.tab_target)) {
      var message = { "action": request.command };
      if(request.args != undefined) {
        message.args = request.args;
      }
      chrome.tabs.sendMessage(parseInt(request.tab_target), message);
      console.log("Single tab request. Sent: " + request.command + " To: " + request.tab_target);
    } else {
      sendAction(request.command);
    }
  };

  /**
   * Capture hotkeys and send their actions to tab(s) with music player running
   */
  chrome.commands.onCommand.addListener(function(command) {
    sendAction(command);
  });

  /**
   * Messages sent from Options page
   */
  chrome.runtime.onMessage.addListener(function(request, sender, response) {
    if(request.action === "update_keys") {
      window.skSites.loadSettings();
    }
    if(request.action === "update_site_settings") {
      console.log("updating site settings: ", request.siteKey, request.siteState);
      window.skSites.setSiteState(request.siteKey, request.siteState).then(function() {
        response(true);
      });
    }
    if(request.action === "get_sites") {
      response(window.skSites.sites);
    }
    if(request.action === "get_site_controller") {
      response(window.skSites.getController(sender.tab.url));
    }
    if(request.action === "inject_controller") {
      console.log("Inject: " + request.file + " into: " + sender.tab.id);
      chrome.tabs.executeScript(sender.tab.id, {file: request.file});
      if (mprisPort) mprisPort.postMessage({ command: "add_player" });
    }
    if(request.action === "check_music_site") {
      /**
       * A tab index of -1 means that the tab is "embedded" in a page
       * We should only inject into actual tabs
       */
      if(sender.tab.index === -1) return response("no_inject");
      response(window.skSites.checkMusicSite(sender.tab.url));
    }
    if(request.action === "get_commands") response(window.coms);
    if(request.action === "command") processCommand(request);
    if(request.action === "update_player_state") {
      tabStates[sender.tab.id] = {
        "timestamp": Date.now(),
        "state": request.stateData
      };
      chrome.runtime.sendMessage({
        action: "update_popup_state",
        stateData: request.stateData,
        fromTab: sender.tab
      });
      if (mprisPort) handleStateData(updateMPRISState);
    }
    if(request.action === "get_music_tabs") {
      var musicTabs = window.skSites.getMusicTabs();
      musicTabs.then(function(tabs) {
        response(tabs);
      });

      return true;
    }
    if(request.action === "send_change_notification") {
      if (window.skSites.checkShowNotifications(sender.tab.url) &&
          window.skSites.checkTabEnabled(sender.tab.id)) {
        sendChangeNotification(request, sender);
      }
    }
  });

  var sendChangeNotification = function(request, sender) {
    if (!request.stateData.song) {
      return;
    }

    var notificationItems = [
        { title: request.stateData.song.trim(), message: "" },
      ];

    if (request.stateData.artist || request.stateData.album) {
      notificationItems.push({ title: (request.stateData.artist || "").trim(), message: (request.stateData.album || "").trim() });
    }

    if (request.stateData.currentTime || request.stateData.totalTime) {
      notificationItems.push({ title: (request.stateData.currentTime || "").trim(), message: (request.stateData.totalTime || "").trim() });
    }

    chrome.notifications.create(sender.id + request.stateData.siteName, {
        type: "list",
        title: request.stateData.siteName,
        message: (request.stateData.song || "").trim(),
        iconUrl: request.stateData.art || chrome.extension.getURL("icon128.png"),
        items: notificationItems
      }, function(notificationId) {
        if(notificationTimeouts[notificationId])
        {
          clearTimeout(notificationTimeouts[notificationId]);
          delete notificationTimeouts[notificationId];
        }

        notificationTimeouts[notificationId] = setTimeout(function() {
          chrome.notifications.clear(notificationId);
        }, 5000);
      });
  };

  /**
   * Copy over old settings from local storageArea to sync.
   * @note This change introduced in v1.5.5. Deprecate this at some point in the future.
   */
  var storageInitializedCheck = new Promise(function(resolve) {
    chrome.storage.sync.get(function(syncStorageObj) {
      if(syncStorageObj["hotkey-initialized"]) {
        resolve();
      } else {
        var newStorageObj = {
          "hotkey-initialized": true
        };

        chrome.storage.local.get(function(localStorageObj) {
          _.forEach(localStorageObj, function(value, key) {
            newStorageObj[key] = value;
          });

          chrome.storage.sync.set(newStorageObj, function() {
            resolve();
          });
        });
      }
    });
  });

  storageInitializedCheck.then(function() {
    // Open info page on install/update
    chrome.runtime.onInstalled.addListener(function(details) {
      chrome.storage.sync.get(function(obj) {
        if(obj["hotkey-open_on_update"] || typeof obj["hotkey-open_on_update"] === "undefined") {
          if(details.reason == "install") {
            chrome.tabs.create({
              url: "http://www.streamkeys.com/guide.html?installed=true"
            });
          }
        }
      });
    });

    // Store commands in global
    chrome.commands.getAll(function(cmds) {
      window.coms = cmds;
    });

    // Define skSites as a sitelist in global context
    window.skSites = new Sitelist();
    window.skSites.loadSettings();
  });


  /**
   * MPRIS support
   */
  var connections = 0;
  var mprisPort = null;

  var handleNativeMsg = function(msg) {
    switch(msg.command) {
      case "play":
      case "pause":
      case "playpause":
        sendAction("playPause");
        break;
      case "stop":
        sendAction("stop");
        break;
      case "next":
        sendAction("playNext");
        break;
      case "previous":
        sendAction("playPrev");
        break;
      case "seek":
        sendAction("seek", msg.args);
        break;
      case "volume":
        sendAction("volume", msg.args);
        break;
      default:
        console.log("Cannot handle native message command: " + msg.command);
      }
  };

  /**
   * Get the state of the player that a command will end up affecting and pass
   * it to a function to handle them, along with the tab that corresponds to
   * that state data. If there is no active tab, then the state and the tab are
   * null. For "single player mode" (which is required for MPRIS support), a
   * command will go to all playing tabs or the best tab. In case we have
   * multiple playing tabs, just use the state of the best playing tab.
   */
  var handleStateData = function(func) {
    var activeMusicTabs = window.skSites.getActiveMusicTabs();
    activeMusicTabs.then(function(tabs) {
      if (_.isEmpty(tabs)) {
        func(null, null);
      } else {
        var bestTab = null;
        var playingTabs = getPlayingTabs(tabs);
        if (_.isEmpty(playingTabs)){
          bestTab = getBestSinglePlayerTab(tabs);
        } else {
          bestTab = getBestSinglePlayerTab(playingTabs);
        }

        // while loading website state may not exist, but the website does
        if(bestTab.id in tabStates) {
          func(tabStates[bestTab.id].state, bestTab);
        }
      }
    });
  };

  /**
   * If stateData is null, then state is stopped with NoTrack. Otherwise update
   * with the state of the player that a command will end up affecting.
   */
  var updateMPRISState = function(stateData, tab) {
    if (stateData === null) {
        mprisPort.postMessage({ command: "remove_player" });
      } else {
        var metadata = {
          "mpris:trackid": stateData.song ? tab.id : null,
          "xesam:title": stateData.song,
          "xesam:artist": stateData.artist ? [stateData.artist.trim()] : null,
          "xesam:album": stateData.album,
          "mpris:artUrl": stateData.art
        };
        var args = [{ "CanGoNext": stateData.canPlayNext,
                  "CanGoPrevious": stateData.canPlayPrev,
                  "PlaybackStatus": (stateData.isPlaying ? "Playing" : "Paused"),
                  "CanPlay": stateData.canPlayPause,
                  "CanPause": stateData.canPlayPause,
                  "CanSeek": stateData.canSeek,
                  "Metadata": metadata}];
        if(stateData.currentTime != null) {
          args[0].Position = stateData.currentTime;
        }
        if(stateData.totalTime != null) {
          args[0].Metadata["mpris:length"] = stateData.totalTime;
        }
        if(stateData.volume != null) {
          args[0].Volume = stateData.volume;
        }
        mprisPort.postMessage({ command: "update_state", args: args });
      }
    };

  /**
   * Connect to the native messaging host for MPRIS support
   */
  chrome.storage.sync.get(function(obj) {

    if (obj.hasOwnProperty("hotkey-use_mpris") && obj["hotkey-use_mpris"]) {
      if (!connections) {
        connections += 1;
        console.log("Starting native messaging host");
        mprisPort = chrome.runtime.connectNative("org.mpris.streamkeys_host");
        mprisPort.onMessage.addListener(handleNativeMsg);

        chrome.runtime.onSuspend.addListener(function() {
          if (!--connections)
            mprisPort.postMessage({ command: "quit" });
            mprisPort.onMessage.removeListener(handleNativeMsg);
            mprisPort.disconnect();
        });
      }
    }
  });

  /**
   * When a music tab is removed, we must remove it from tabStates and update
   * the state of the MPRIS player.
   */
  chrome.tabs.onRemoved.addListener(function(tabId) {
    if (tabStates.hasOwnProperty(tabId)) {
      delete tabStates[tabId];
      if (mprisPort) handleStateData(updateMPRISState);
    }
  });

  /**
   * When the active tab changes, the best single tab might change too. Thus we
   * need to update the state of the MPRIS player.
   */
  chrome.tabs.onActivated.addListener(function(activeInfo) {
    if (mprisPort && tabStates.hasOwnProperty(activeInfo.tabId)) {
      handleStateData(updateMPRISState);
    }
  });

})();
