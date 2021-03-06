import dom from "./jsdom.js";
import { render } from "../dist/index.js";
import {
  useEffect,
  useMemo,
  useRef,
  useCallback,
  createElement,
  useState,
  useReducer,
  createContext,
  useContext,
  Fragment as ReactFragment,
  Component as ReactComponent,
  forwardRef, Fragment
} from "react";

const Context = createContext(0);
const { Provider, Consumer } = Context;


class ErrorBoundary extends ReactComponent {

  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // You can also log the error to an error reporting service
    console.log("Caught", error, errorInfo);

    setTimeout(() => {
      this.setState({ hasError: false });
    }, 200)
  }

  render() {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return createElement("h1", {}, "Something went wrong.")
    }

    return this.props.children;
  }

}

const Forwarded = forwardRef(function Forwarded(props, ref) {
  useRef(1);
  return createElement("button", { type: "button", ref }, "Forwarded");
});

function A() {

  const [state, onState] = useReducer((state) => state + 1, 1, undefined);

  const [isLoaded, setIsLoaded] = useState(false);

  const promise = useMemo(async () => {
    await new Promise(resolve => setTimeout(resolve, 200));
    setIsLoaded(true);
    console.log("Promise finished");
  }, [setIsLoaded]);

  console.log({ state, isLoaded, promise });

  if (!isLoaded) throw promise;

  useEffect(() => {
    let count = 0;
    const interval = setInterval(() => {
      if ((count += 1) > 3) {
        clearInterval(interval);
      } else {
        console.log("on state");
        onState();
      }
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
    createElement("a", { href: "https://example.com", target: "_blank" }, `D: ${state}`)
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

  const ref = useRef();

  return createElement(
    A,
    {  }
  );
}


process.on("uncaughtException", console.log.bind("uncaughtException"))
process.on("unhandledRejection", console.log.bind("unhandledRejection"))
process.on("warning", console.log.bind("warning"))

try {
  await render(createElement(Component), dom.window.document.body, {
    onContext(context) {
      (async () => {
        for await (const events of context.events.hydrate) {
          console.log(window.document.body.outerHTML)
        }
      })()
        .catch(console.error);
    },
    settleAfterTimeout: 2000
  });
  console.log(window.document.body.outerHTML)
  console.log("Finished rendering");
} catch (e) {
  console.error(e);
}
