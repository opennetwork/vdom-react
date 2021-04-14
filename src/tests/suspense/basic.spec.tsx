import { renderAsync } from "../../index";
import { screen } from "@testing-library/dom";
import { useRef } from "react";

describe("Basic Suspense", function () {
    it("renders after promise", async () => {

        const promise = Promise.resolve();
        function Component() {
            const thrown = useRef(false);
            if (!thrown.current) {
                thrown.current = true;
                throw promise;
            }
            return <p data-testid="result">Rendered!</p>;
        }

        await renderAsync(
            <Component />,
            document.body,
            {
                maxIterations: 2
            }
        );

        const p = screen.getByTestId("result");
        expect(p.innerHTML).toEqual("Rendered!");
    });

    it ("works with an inner component", async () => {
        const promise = Promise.resolve();
        function Inner() {
            const thrown = useRef(false);
            if (!thrown.current) {
                thrown.current = true;
                throw promise;
            }
            return <p data-testid="result">Rendered!</p>;
        }

        function Component() {
            // Trigger gook functionality for component
            useRef();
            return <Inner />;
        }

        await renderAsync(
            <Component />,
            document.body,
            {
                maxIterations: 2
            }
        );

        const p = screen.getByTestId("result");
        expect(p.innerHTML).toEqual("Rendered!");

    });
});
