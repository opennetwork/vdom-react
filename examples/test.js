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
  useContext
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

  return createElement("b", { key: "stable" }, `A: ${state}`)
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

  return createElement(Inside);

  async function Inside() {
    return createElement(WithProvider);
  }
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



async function log() {
  for await (const event of context.events.hydrate) {
    console.log(window.document.body.outerHTML)
  }
}
