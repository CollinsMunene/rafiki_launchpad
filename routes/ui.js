var express = require('express');
var router = express.Router();


/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("index", { title: "Rafiki Launch Pad" });
});

router.get("/instances/new", function (req, res, next) {
  res.render("instance_new", { title: "Rafiki Launch Pad || New Instance" });
});


module.exports = router;
