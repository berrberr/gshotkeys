;(function() {
  "use strict";

  var BaseController = require("BaseController");

  new BaseController({
    siteName: "Slacker",
    play: "a.play",
    pause: "a.pause",
    playNext: "li.skip-forward > a",
    playPrev: "li.skip-back > a",
    like: "li.love > a",
    dislike: "li.banning > a",

    playState: ".playpause.play"
  });
})();
