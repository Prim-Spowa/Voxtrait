import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readInitialTheme, useTheme } from "../useTheme";

function Harness() {
  const { theme, isDark, toggle } = useTheme();
  return (
    <button onClick={toggle}>
      {theme}/{String(isDark)}
    </button>
  );
}

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});

describe("useTheme (ST 11.1)", () => {
  it("restaure la préférence enregistrée et la pose sur <html>", async () => {
    window.localStorage.setItem("doublure:theme", "dark");
    render(<Harness />);
    expect(await screen.findByText("dark/true")).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("bascule et persiste le choix dans localStorage", async () => {
    render(<Harness />);
    await screen.findByText("light/false");
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("dark/true");
    expect(window.localStorage.getItem("doublure:theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("readInitialTheme suit prefers-color-scheme sans préférence enregistrée", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true }) as unknown as typeof matchMedia
    );
    expect(readInitialTheme()).toBe("dark");
  });

  it("readInitialTheme tolère un localStorage indisponible", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => readInitialTheme()).not.toThrow();
    getItem.mockRestore();
  });
});
