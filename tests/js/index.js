// Einstieg für "node --test tests/js/": Node 22 führt einen Ordner-Pfad als
// Modul aus (also diese index.js), statt ihn nach Testdateien zu durchsuchen.
// Deshalb hier alle *.test.js dieses Ordners laden.
const fs = require("node:fs");
const path = require("node:path");

fs.readdirSync(__dirname).filter(f => f.endsWith(".test.js")).sort().forEach(f => require(path.join(__dirname, f)));
