import dom from "./jsdom.js";
import { render } from "../dist/index.js";
import * as s from 'styled-components';
import {
  createElement,
  Fragment, useEffect, useState
} from "react";

const { default: styled } = s.default;

const Input = styled.input`
  font-size: 32px;
  color: #333;
  text-align: right;
  padding: 5px 13px;
  width: 100%;
  border: none;
  border-bottom: 1px solid gray;
  box-sizing: border-box;
`;


const ButtonGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-gap: 15px;
`;

const Button = styled.button`
  padding: 10px;
  font-size: 22px;
  color: #eee;
  background: rgba(0, 0, 0, 0.5);
  cursor: pointer;
  border-radius: 2px;
  border: 0;
  outline: none;
  opacity: 0.8;
  transition: opacity 0.2s ease-in-out;
  &:hover {
    opacity: 1;
  }
  &:active {
    background: #999;
    box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.6);
  }

  &.two-span {
    grid-column: span 2;
    background-color: #3572db;
  }
`;

const ExtraData = styled.div`
  margin-top: 8px;
  padding: 20px 16px;
  p,
  pre,
  code {
    text-align: left;
    margin: 0;
    padding: 0;
    margin-top: 12px;
  }
`;


process.on("uncaughtException", console.log.bind("uncaughtException"))
process.on("unhandledRejection", console.log.bind("unhandledRejection"))
process.on("warning", console.log.bind("warning"))

const buttons = [
  'C',
  'CE',
  '/',
  '7',
  '8',
  '9',
  'x',
  '4',
  '5',
  '6',
  '-',
  '1',
  '2',
  '3',
  '+',
  '0',
  '.',
  '=',
  '%',
];

try {
  function App() {

    const [state, setState] = useState("0.");
    console.log({ state });

    useEffect(() => {
      let v = Math.random();
      const interval = setInterval(() => {
        setState(`${v += 1}`);
      }, 1000);
      return () => clearInterval(interval);
    }, [])

    function handleButtonClick() {

    }

    return createElement("div", {
      key: "root",
      style: {
        width: 300,
        height: 'auto',
        border: '1px solid rgba(0,0,0,0.05)',
        margin: '0 auto',
        marginTop: 16,
      }
      },
      createElement("div", {},
        createElement(Input, {
          type: "text",
          value: state,
          disabled: true,
          style: {
            width: '100%',
            textAlign: 'right',
            padding: '8px 20px',
            border: 'none',
            outline: 'none',
          }
        })
      ),
      createElement(ButtonGrid, { style: {
          padding: '8px 20px',
          width: '100%',
          boxSizing: 'border-box',
        }}, buttons.map((btn, index) => (
          createElement(Button, {
            className: btn === 'C' ? 'two-span' : '',
            type: "button",
            key: index,
            onClick: handleButtonClick(btn)
          }, btn)
        )))
    )
  }
  await render(App, dom.window.document.body, {
    rendered() {
      console.log(window.document.body.outerHTML);
    }
  });
  console.log(window.document.head.outerHTML);
  console.log(window.document.body.outerHTML);
  console.log("Finished rendering");
} catch (e) {
  console.error(e);
}
