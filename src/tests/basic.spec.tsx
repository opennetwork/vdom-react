import { renderAsync } from "../index";
import { useCallback, useEffect, useState } from "react";
import { screen } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";

describe("Basic", function () {
    it("renders static", async () => {
        function Component() {
            return <p>Hello!</p>;
        }

        await renderAsync(
            <Component />,
            document.body
        );
    });

    it ("allows state to be set", async () => {
        function Component() {
            const [state, setState] = useState<string>("Default");
            const onClick = useCallback(() => {
                setState("Clicked!");
            }, [setState]);
            return <p onClick={onClick} data-testid="paragraph">{state}</p>;
        }

        let clicked = false;

        await renderAsync(
            <Component />,
            document.body,
            {
                async rendered() {
                    if (!clicked) {
                        const p = screen.getByTestId("paragraph");
                        userEvent.click(p);
                        clicked = true;
                    }
                },
                maxIterations: 2
            }
        );

        const p = screen.getByTestId("paragraph");
        expect(p.innerHTML).toEqual("Clicked!");

    });

    it("allows interval to set state", async () => {

        const values = Array.from({ length: 3 + Math.floor(Math.random() * 20) }, () => `${Math.random()}`);
        const lastValue = values[values.length - 1];
        function Component() {
            const [state, setState] = useState<string>("Default");
            useEffect(() => {
               const interval = setInterval(
                   function () {
                       const next = values.shift();
                       if (next) {
                           setState(next);
                       }
                       if (!values.length) {
                           clearInterval(interval);
                       }
                   },
                    10
               );
               return () => {
                   clearInterval(interval);
               };
            });
            return <p data-testid="paragraph">{state}</p>;
        }

        const rendered = jest.fn();

        const maxIterations = values.length + 1;

        await renderAsync(
            <Component />,
            document.body,
            {
                rendered,
                maxIterations
            }
        );

        const p = screen.getByTestId("paragraph");
        expect(p.innerHTML).toEqual(lastValue);
        expect(rendered.mock.calls.length).toEqual(maxIterations);
    });
});
