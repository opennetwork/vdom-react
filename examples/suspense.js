import dom from "./jsdom.js";
import {createElement, useRef} from "react";
import {render} from "../dist/index.js";

const promise = Promise.resolve();
function Inner() {
  const thrown = useRef(false);
  console.log({ thrown });
  if (!thrown.current) {
    thrown.current = true;
    throw promise;
  }
  console.log("Inner");
  return createElement("p", {}, "Rendered!");
}

function Component() {
  // Trigger hook functionality for component
  useRef();
  return createElement(Inner);
}

await render(createElement(Component), dom.window.document.body, {
  settleAfterMacrotask: true
});

console.log("Complete");
console.log(dom.window.document.body.outerHTML);
