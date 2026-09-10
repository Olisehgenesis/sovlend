"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type SearchableSelectOption = {
  value: string;
  label: string;
  /** Extra text (e.g. account type, currency) matched against the search query but not shown as the label. */
  searchText?: string;
};

/**
 * A type-to-filter account/GL-account picker: renders like a normal text input (so it drops
 * straight into the existing .entity-form label/input styling) but filters a long option list
 * as you type and posts the chosen id via a hidden input, so server actions / FormData-based
 * submits work exactly as they would with a plain <select>. Built without a UI-library
 * dependency since none of the existing forms pull one in.
 */
export function SearchableSelect({
  name,
  options,
  defaultValue,
  placeholder,
  disabled,
  onChange,
  emptyMessage,
}: {
  name: string;
  options: SearchableSelectOption[];
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  emptyMessage?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [query, setQuery] = useState(() => options.find((option) => option.value === defaultValue)?.label ?? "");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the visible text (and the parent's controlled state, via onChange) in sync if the
  // caller swaps the option list out from under us -- e.g. switching currency re-filters the
  // account list for the journal-entry pickers, invalidating a previously chosen account.
  // Adjusted during render (React's documented pattern for resetting state from a changed prop)
  // rather than in an effect, so there's no extra render pass or setState-in-effect violation.
  const [prevOptions, setPrevOptions] = useState(options);
  if (options !== prevOptions) {
    setPrevOptions(options);
    const stillValid = options.some((option) => option.value === value);
    if (!stillValid && value) {
      setValue("");
      setQuery("");
      onChange?.("");
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => (option.searchText ? `${option.label} ${option.searchText}` : option.label).toLowerCase().includes(q));
  }, [query, options]);

  const highlightedIndex = highlighted >= filtered.length ? 0 : highlighted;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        const selected = options.find((option) => option.value === value);
        setQuery(selected ? selected.label : "");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [value, options]);

  function selectOption(option: SearchableSelectOption) {
    setValue(option.value);
    setQuery(option.label);
    setOpen(false);
    onChange?.(option.value);
  }

  return (
    <div className="searchable-select" ref={containerRef}>
      <input
        type="text"
        value={query}
        placeholder={placeholder ?? "Type to search..."}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setHighlighted(0);
          if (value) {
            setValue("");
            onChange?.("");
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setHighlighted((current) => Math.min(current + 1, filtered.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlighted((current) => Math.max(current - 1, 0));
          } else if (event.key === "Enter") {
            if (open && filtered[highlightedIndex]) {
              event.preventDefault();
              selectOption(filtered[highlightedIndex]);
            }
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      <input type="hidden" name={name} value={value} />
      {open ? (
        <ul className="searchable-select-options" role="listbox">
          {filtered.length === 0 ? (
            <li className="searchable-select-empty">{emptyMessage ?? "No matches"}</li>
          ) : (
            filtered.map((option, index) => (
              <li
                key={option.value}
                role="option"
                aria-selected={index === highlightedIndex}
                className={index === highlightedIndex ? "highlighted" : undefined}
                onMouseEnter={() => setHighlighted(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectOption(option);
                }}
              >
                {option.label}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
