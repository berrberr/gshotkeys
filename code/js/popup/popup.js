"use strict";

var $ = require("jquery"),
    ko = require("ko"),
    _ = require("lodash");
require("../lib/jquery.marquee.js");
require("../lib/material.min.js");

var PopupViewModel = function PopupViewModel() {
  var self = this;

  self.totalMusicTabs = ko.observable(1);
  self.musicTabsLoaded = ko.observable(0);
  self.musicTabs = ko.observableArray([]);

  // Tabs from disabled music sites to show in disabled list toggle
  self.disabledMusicTabs = ko.observableArray([]);
  self.disabledSitesOpen = ko.observable(false);

  // Filter hidden players and sort by priority -> siteName -> tabId
  self.sortedMusicTabs = ko.pureComputed(function() {
    var filteredGrouped = _.groupBy(
      _.filter(self.musicTabs(), function(tab) {
        return (tab.canPlayPause() || !tab.hidePlayer);
      }),
      function(tab) { return tab.priority(); }
    );

    var sortedKeys = _.sortBy(
      _.keys(filteredGrouped),
      function(priority) { return priority * -1; }
    );

    var filteredGroupedSorted = [];

    _.each(sortedKeys, function(key) {
      filteredGroupedSorted.push(
        _.sortByAll(
          filteredGrouped[key], ["siteName", "tabId"]
        )
      );
    });

    return _.flatten(filteredGroupedSorted);
  });

  self.isLoaded = ko.pureComputed(function() {
    return self.musicTabsLoaded() == self.totalMusicTabs();
  });

  self.visibleMusicTabs = ko.observableArray([]);
  self.optionsUrl = ko.observable(chrome.runtime.getURL("html/options.html"));

  self.openOptionsPage = function() {
    window.open(self.optionsUrl());
  };

  // Send a request to get the player state of every active music site tab
  chrome.runtime.sendMessage({ action: "get_music_tabs" }, self.getTabStates.bind(this));

  // Setup listener for updating the popup state
  chrome.runtime.onMessage.addListener(function(request) {
    if(request.action === "update_popup_state" && request.stateData) self.updateState(request.stateData, request.fromTab);
  });
};

PopupViewModel.prototype.updateState = function(stateData, tab, disabled) {
  if(typeof stateData == "undefined") return false;

  var self = this;

  var musicTab = _.findWhere(
    _.union(this.musicTabs.peek(), this.disabledMusicTabs.peek()),
    { tabId: tab.id }
  );

  if(musicTab) {
    // Update observables
    _.forEach(musicTab.observableProperties, function(property) {
      if(typeof stateData[property] !== "undefined") musicTab[property](stateData[property]);
    });
  } else {
    // Create new tab
    musicTab = new MusicTab(_.assign(stateData, {
      tabId: tab.id,
      faviconUrl: tab.favIconUrl,
      priority: tab.streamkeysPriority,
      siteKey: tab.streamkeysSiteKey,
      streamkeysEnabled: typeof tab.streamkeysEnabled !== "undefined" ? tab.streamkeysEnabled : true,
    }));

    if(disabled) {
      this.disabledMusicTabs.push(musicTab);
    } else {
      this.musicTabs.push(musicTab);
    }

    // Subscribe to each sites priority to maintain state if multiple tabs are open
    musicTab.priority.subscribe(function(newPriority) {
      _.each(self.musicTabs(), function(tab) {
        if(tab.siteKey === this.siteKey && tab.tabId !== this.tabId && tab.priority() !== newPriority) {
          tab.priority(newPriority);
        }
      }, this);
    }, musicTab);
  }
};

/**
 * Query each active music tab for the player state, then update the popup state
 * @param {Array} tabs - array of active music tabs
 */
PopupViewModel.prototype.getTabStates = function(tabs) {
  var that = this;
  that.totalMusicTabs(tabs.enabled.length + tabs.disabled.length);

  _.forEach(tabs.enabled, function(tab) {
    chrome.tabs.sendMessage(tab.id, { action: "getPlayerState" }, (function(playerState) {
      that.updateState(playerState, this.tab);
      that.musicTabsLoaded(that.musicTabsLoaded.peek() + 1);
    }).bind({ tab: tab }));
  });

  _.forEach(tabs.disabled, function(tab) {
    chrome.tabs.sendMessage(tab.id, { action: "getPlayerState" }, (function(playerState) {
      that.updateState(playerState, this.tab, true);
      that.musicTabsLoaded(that.musicTabsLoaded.peek() + 1);
    }).bind({ tab: tab }));
  });
};

var MusicTab = (function() {
  function MusicTab(attributes) {
    var self = this;

    this.observableProperties = [
      "song",
      "artist",
      "streamkeysEnabled",
      "priority",
      "isPlaying",
      "canPlayPause",
      "canPlayNext",
      "canPlayPrev",
      "canLike",
      "canDislike"
    ];

    _.assign(this, attributes);

    /** Override observables **/
    _.forEach(this.observableProperties, function(property) {
      this[property] = ko.observable(typeof attributes[property] !== "undefined" ? attributes[property] : null);
    }, this);

    /** Popup specific observables **/
    this.songArtistText = ko.pureComputed(function() {
      if(!this.song()) return "";

      return (this.artist()) ? this.artist() + " - " + this.song() : this.song();
    }, this);

    this.settingsOpen = ko.observable(false);

    this.priority.subscribe(function(priority) {
      chrome.runtime.sendMessage({
        action: "update_site_settings",
        siteKey: self.siteKey,
        siteState: {
          priority: priority
        }
      });
    });

    this.sendAction = function(action) {
      chrome.runtime.sendMessage({
        action: "command",
        command: action,
        tab_target: this.tabId
      });
    };

    this.openTab = function() {
      chrome.tabs.update(parseInt(this.tabId), { selected: true });
    };

    this.toggleStreamkeysEnabled = function() {
      this.streamkeysEnabled(!this.streamkeysEnabled.peek());
      chrome.extension.getBackgroundPage().window.sk_sites.markTabEnabledState(this.tabId, this.streamkeysEnabled.peek());
    };
  }

  return MusicTab;
})();

document.addEventListener("DOMContentLoaded", function() {
  window.popup = new PopupViewModel();

  ko.applyBindings(window.popup);

  ko.bindingHandlers.scrollingSong = {
    update: function(element, valueAccessor) {
      $(element).text(ko.unwrap(valueAccessor()));
      if($(element).outerWidth() > $("#player").width()) {
        // Remove any old marquees
        $(element).marquee("destroy");
        var scrollDuration = (parseInt($(element).outerWidth()) * 15);

        $(element).bind("finished", function() {
          $(this).find(".js-marquee-wrapper").css("margin-left", "0px");
        }).marquee({
          allowCss3Support: false,
          delayBeforeStart: 2500,
          duration: scrollDuration,
          pauseOnCycle: true
        });
      }
    }
  };

  ko.bindingHandlers.slideMenu = {
    update: function(element, valueAccessor) {
      var value = ko.unwrap(valueAccessor());

      if(value) {
        $(element).slideDown("fast");
      } else {
        $(element).slideUp("fast");
      }
    }
  };
});
