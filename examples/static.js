import dom from "./jsdom.js";
import { render } from "../dist/index.js";
import {
  createElement,
  Fragment
} from "react";

function Test() {
  return createElement("span", {}, "Hello");
}

function Component() {
  return createElement(
    Fragment,
    {},
    createElement("h1", {}, "Hello!"),
    createElement("section", {},
      createElement("p", {}, "blah blah"),
      createElement("p", {}, "blah blah blah")
    ),
    createElement("section", {},
      createElement("p", {}, "blah blah"),
      createElement("p", {}, "blah blah blah")
    ),
    createElement("footer", {},
      createElement("p", {}, new Date().getFullYear()),
    ),
    createElement(Test)
  );
}


process.on("uncaughtException", console.log.bind("uncaughtException"))
process.on("unhandledRejection", console.log.bind("unhandledRejection"))
process.on("warning", console.log.bind("warning"))

try {
  await render(createElement(Component), dom.window.document.body);
  console.log(window.document.body.outerHTML)
  console.log("Finished rendering");
} catch (e) {
  console.error(e);
}
