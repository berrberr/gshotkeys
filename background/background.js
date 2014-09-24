"use strict";

//***
//@return [RegExp] a regex that matches where the string is in a url's (domain) name
//***
var URL_check = function(domain) {
  return (new RegExp("^(http|https)*(:\/\/)*(.*\\.)*(" + domain + "|www." + domain +")+\\."));
};

//***
//Base class for all sites enabled in extension
//***
var Sitelist = function()
{
  this.sites = {
    "7digital": {name: "7digital", url: "http://www.7digital.com", enabled: true, url_regex: null},
    "8tracks": {name: "8tracks", url: "http://www.8tracks.com", enabled: true, url_regex: null},
    "amazon": {name: "Amazon Cloud Player", url: "https://www.amazon.com/gp/dmusic/cloudplayer/player", enabled: true, url_regex: null},
    "bandcamp": {name: "Bandcamp", url: "http://www.bandcamp.com", enabled: true, url_regex: null},
    "bop": {name: "Bop.fm", url: "http://www.bop.fm", enabled: true, url_regex: null},
    "deezer": {name: "Deezer", url: "http://www.deezer.com", enabled: true, url_regex: null},
    "di": {name: "Di.fm", url: "http://www.di.fm", enabled: true, url_regex: null},
    "earbits": {name: "Earbits", url: "http://www.earbits.com", enabled: true, url_regex: null},
    "player.edge": {name: "Edge Player", url: "http://player.edge.ca", enabled: true, url_regex: null},
    "grooveshark": {name: "Grooveshark", url: "http://www.grooveshark.com", enabled: true, url_regex: null},
    "hypem": {name: "Hypemachine", url: "http://www.hypem.com", enabled: true, url_regex: null},
    "iheart": {name: "iHeartRadio", url: "http://www.iheart.com", enabled: true, url_regex: null},
    "jango": {name: "Jango", url: "http://www.jango.com", enabled: true, url_regex: null},
    "last": {name: "LastFm", url: "http://www.last.fm", enabled: true, url_regex: null},
    "mixcloud": {name: "Mixcloud", url: "http://www.mixcloud.com", enabled: true, url_regex: null},
    "music.sonyentertainmentnetwork": {name: "SonyMusicUnlimited", url: "https://music.sonyentertainmentnetwork.com", enabled: true, url_regex: null},
    "myspace": {name: "MySpace", url: "http://www.myspace.com", enabled: true, url_regex: null},
    "npr": {name: "NPR One Player", url: "http://one.npr.org", enabled: true, url_regex: null},
    "pandora": {name: "Pandora", url: "http://www.pandora.com", enabled: true, url_regex: null},
    "plex": {name: "Plex", url: "http://www.plex.tv", enabled: true, url_regex: null},
    "pleer": {name: "Pleer.com", url: "http://pleer.com", enabled: true, url_regex: null},
    "play.google": {name: "Google Music", url: "http://play.google.com", enabled: true, url_regex: null},
    "radioparadise": {name: "RadioParadise", url: "http://www.radioparadise.com", enabled: true, url_regex: null},
    "rdio": {name: "Rdio", url: "http://www.rdio.com", enabled: true, url_regex: null},
    "seesu": {name: "Seesu.me", url: "http://www.seesu.me", enabled: true, url_regex: null},
    "spotify": {name: "Spotify Web Player", url: "http://www.spotify.com", enabled: true, url_regex: null},
    "soundcloud": {name: "Soundcloud", url: "http://www.soundcloud.com", enabled: true, url_regex: null},
    "songstr": {name: "Songstr", url: "http://www.songstr.com", enabled: true, url_regex: null},
    "songza": {name: "Songza", url: "http://www.songza.com", enabled: true, url_regex: null},
    "slacker": {name: "Slacker", url: "http://www.slacker.com", enabled: true, url_regex: null},
    "stitcher": {name: "Stitcher", url: "http://www.stitcher.com", enabled: true, url_regex: null},
    "tunein": {name: "TuneIn", url: "http://www.tunein.com", enabled: true, url_regex: null},
    "thesixtyone": {name: "TheSixtyOne", url: "http://www.thesixtyone.com", enabled: true, url_regex: null},
    "vk": {name: "Vkontakte", url: "http://www.vk.com", enabled: true, url_regex: null},
    "youarelistening": {name: "YouAreListening.to", url: "http://www.youarelistening.to", enabled: true, url_regex: null},
    "youtube": {name: "YouTube", url: "http://www.youtube.com", enabled: false, url_regex: null}
  };

  //Get site settings from localstorage
  this.load_settings = function() {
    var self = this;
    chrome.storage.local.get(function(obj) {
      var objSet = obj.hasOwnProperty("hotkey-sites");
      $.each(self.sites, function(key) {
        if(objSet && (typeof obj["hotkey-sites"][key] !== "undefined")) self.sites[key].enabled = obj["hotkey-sites"][key];
        self.sites[key].url_regex = new URL_check(key);
      });
    });
  };

  //@return [arr] enabled sites
  this.get_enabled = function() {
    return $.map(this.sites, function(val, key) {
      if(val.enabled) return key;
    });
  };

  //@param url [str] url of site to check for
  //@return [bool] true if url matches an enabled site
  this.check_enabled = function(url) {
    var _sites = this.sites;
    return this.get_enabled().some(function(sitename) {
      return (_sites[sitename].url_regex.test(url));
    });
  };
};

//***
//Capture hotkeys and send their actions to tab(s) with music player running
//***
chrome.commands.onCommand.addListener(function(command) {
  //chrome.runtime.sendMessage({"action": command});
  chrome.tabs.query({}, function(tabs) {
    tabs.forEach(function(tab) {
      if(window.sk_sites.check_enabled(tab.url)) {
        chrome.tabs.sendMessage(tab.id, {"action": command});
        console.log("SENT " + command + " TO " + tab.url);
      }
    });
  });
});

//***
//Messages sent from Options page
//***
chrome.runtime.onMessage.addListener(function(request, sender, response) {
  if(request.action === "update_keys") {
    console.log("Options page has updated settings. Reloading...");
    window.sk_sites.load_settings();
  }
  if(request.action === "get_sites") {
    console.log("Options page wants the sitelist.");
    response(window.sk_sites.sites);
  }
  if(request.action === "get_commands") {
    response(window.coms);
  }
});

//***
//Open info page on install/update
//***
chrome.runtime.onInstalled.addListener(function(details) {
  if(details.reason == "install") {
    //Only open the site if not already on it
    //streamkeys-install session var will be created on click of install button on streamkeys site
    //TODO: figure out how to make this work
    //var fromSite = sessionStorage.getItem("streamkeys-install");
    //if(fromSite === null)
    chrome.tabs.create({url: "http://www.streamkeys.com/guide.html?installed=true"});
  } else if(details.reason == "update") {
    chrome.tabs.create({url: "http://www.streamkeys.com/guide.html?updated=true"});
  }
});

//***
//Define sk_sites as a sitelist in global context
//***
(function() {
  window.sk_sites = new Sitelist();
  window.sk_sites.load_settings();
  chrome.commands.getAll(function(cmds) {
    window.coms = cmds;
  });
})();
