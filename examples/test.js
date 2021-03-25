import dom from "./jsdom.js";
import { React as ReactWrapper } from "../dist/index.js";
import {Fragment} from "@opennetwork/vnode";
import {
  useEffect,
  useMemo,
  useRef,
  useCallback,
  createElement,
  useState,
  useReducer,
  createContext,
  useContext, useLayoutEffect,
  Fragment as ReactFragment
} from "react";
import {render, DOMVContext} from "@opennetwork/vdom";

const Context = createContext(0);
const { Provider, Consumer } = Context;

let index = 0;

function A() {
  const [state, onState] = useReducer((state) => state + 1, 1, undefined);


  useEffect(() => {
    console.log("interval");
    let count = 0;
    const interval = setInterval(() => {
      console.log("set state");
      count += 1;
      if (count > 3) {
        clearInterval(interval);
      }
      onState();
    }, 300);
    return () => {
      clearInterval(interval);
    }
  }, [])

  console.log(`A: ${state}`);

  const onClick = useCallback(async () => {
    console.log("clicked!")

    await new Promise(resolve => setTimeout(resolve, 1500));

    console.log("After click");

  }, [])

  const ref = useRef(null)

  return createElement(
    ReactFragment,
    {},
    createElement("b", { key: "stable", onClick, id: "clickable", ref }, `A: ${state}`),
    createElement("c", { }, `D: ${state}`)
  )
}

async function Z() {
  return createElement("strong", {}, "Z")
}

function WithConsumer() {
  const value = useContext(Context);
  return createElement("p", {}, `${typeof value}: ${value}`);
}

function WithProvider() {
  return createElement(
    Provider,
    { value: 1 },
    createElement(WithConsumer)
  );
}

function Component() {

  console.log(useRef())
  // console.log(useMemo(() => index += 1, [index]));
  // console.log(useCallback(() => index, [])())
  // console.log(useEffect(() => {
  //   console.log("to to")
  // }, [index]))

  return createElement(A);
}

const context = new DOMVContext({
  root: dom.window.document.body
});
const logPromise = log();

try {

  await render(ReactWrapper({}, { reference: Fragment, source: Component, options: {} }), context);
  await logPromise;
  console.log("Finished rendering");
  console.log(window.document.body.outerHTML)
} catch (e) {
  console.error(e);
}

var usedElement = undefined;

async function log() {
  for await (const event of context.events.hydrate) {
    console.log(window.document.body.outerHTML)

    const element = window.document.getElementById("clickable");

    if (element && !usedElement) {
      usedElement = element;

      const event = window.document.createEvent("HTMLEvents");
      event.initEvent("click", false, true);
      element.dispatchEvent(event);
    }

  }
}
