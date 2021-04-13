import { renderAsync } from "../index";
import { useCallback, useState } from "react";
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
});
