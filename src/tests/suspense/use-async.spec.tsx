import { renderAsync } from "../../index";
import { screen } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { useMemo, useRef, useState } from "react";

function useAsync<T>(fn: () => Promise<T>, deps?: unknown[]): T {
  const [loaded, setLoaded] = useState(false);
  const [value, setValue] = useState<T | undefined>(undefined);
  const [error, setError] = useState(undefined);
  const externalPromise = useMemo(fn, deps);
  const promise = useMemo(async () => {
    setLoaded(false);
    setValue(undefined);
    setError(undefined);
    try {
      const value = await externalPromise;
      setValue(value);
      setLoaded(true);
    } catch (error) {
      setError(error);
    }
  }, [externalPromise, setLoaded, setValue, setError]);
  if (error) throw error;
  if (!loaded) throw promise;
  assertValueT(value);
  return value;
  function assertValueT(input: unknown): asserts input is T {
    if (!loaded || input !== value) {
      throw new Error("Expected loaded value");
    }
  }
}

describe("useAsync Suspense", function () {

  it("render as expected", async () => {

    const expectedValue = `${Math.random()}`;
    function Component() {
      const value = useAsync(async () => expectedValue);
      return <p data-testid="result">{value}</p>;
    }

    await renderAsync(
      <Component />,
      document.body,
      {
        maxIterations: 2
      }
    );

    const p = screen.getByTestId("result");
    expect(p.innerHTML).toEqual(expectedValue);
  });
});
