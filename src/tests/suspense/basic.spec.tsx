import { renderAsync } from "../../index";
import { screen } from "@testing-library/dom";
import { useRef } from "react";
import { noop } from "../../noop";

describe("Basic Suspense", function () {
    it("renders after promise", async () => {

        function Component() {
            const thrown = useRef(false);
            console.log({ thrownComponent: thrown });
            if (!thrown.current) {
                thrown.current = true;
                throw Promise.resolve();
            }
            return <p data-testid="result">Rendered!</p>;
        }

        await renderAsync(
            <Component />,
            document.body,
            {
                settleAfterMacrotask: true,
                promise: noop
            }
        );

        const p = screen.getByTestId("result");
        expect(p.innerHTML).toEqual("Rendered!");
    });

    it ("works with an inner component", async () => {
        function Inner() {
            const thrown = useRef(false);
            console.log({ thrownInner: thrown });
            if (!thrown.current) {
                thrown.current = true;
                throw Promise.resolve();
            }
            return <p data-testid="result">Rendered!</p>;
        }

        function Component() {
            // Trigger hook functionality for component
            useRef();
            return <Inner />;
        }

        await renderAsync(
            <Component />,
            document.body,
            {
                settleAfterMacrotask: true,
                promise: noop
            }
        );

        const p = screen.getByTestId("result");
        expect(p.innerHTML).toEqual("Rendered!");

    });
});
