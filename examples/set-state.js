import "./jsdom.js"
import {createElement, useCallback, useState} from "react";
import {renderAsync} from "../dist/index.js";
import {noop} from "../dist/noop.js";
import { AsyncDebugger } from "../dist/async-debugger.js";
import {ok} from "assert";

const asyncDebugger = new AsyncDebugger();

function Component() {
  const [state, setState] = useState("Default");
  const onClick = useCallback(() => {
    console.log("on click");
    setState("Clicked!");
  }, [setState]);
  console.log({ state });
  return createElement("p", { onClick, id: "paragraph" }, state);
}

let clicked = false;

await renderAsync(
  createElement(Component),
  document.body,
  {
    onContext(context) {
      (async () => {
        for await (const events of context.events.hydrate) {
          if (!clicked) {
            const p = document.getElementById("paragraph");
            if (p) {
              p.click();
              clicked = true;
            }
          }
          console.log(window.document.body.outerHTML)
        }
      })()
        .catch(console.error);
    },
    settleAfterTimeout: 500,
  }
);

const p = document.getElementById("paragraph");
console.log(document.body.outerHTML);
