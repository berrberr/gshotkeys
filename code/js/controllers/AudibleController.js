;(function() {
  "use strict";

  var BaseController = require("BaseController");

  new BaseController({
    siteName: "Audible",
    play: ".main_ctrl .play",
    pause: ".main_ctrl .pause",
    playPrev: ".main_ctrl .repeat",

    playState: ".main_ctrl .play.hide",
    song: ".chapter",

    hidePlayer: true
  });
})();
