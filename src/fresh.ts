import { addDays } from "./food-validate";

export type FreshDinner = {
  date: string;
  recipeName: string;
};

export type FreshTiming = {
  dueDate: string | null;
  dinnerDate: string | null;
  recipeName: string | null;
};

/**
 * A fresh grocery line that comes from a planned meal is due the day before
 * that meal. The earliest meal wins. A fresh line with no plan date has no due
 * date and stays on the ordinary list. Weeks are Monday–Sunday, so a Monday
 * dinner is due the Sunday before it.
 */
export function freshTiming(itemFresh: boolean, dinners: FreshDinner[]): FreshTiming {
  if (!itemFresh) return { dueDate: null, dinnerDate: null, recipeName: null };
  const dated = dinners.filter((dinner) => dinner.date);
  if (!dated.length) return { dueDate: null, dinnerDate: null, recipeName: null };
  const earliest = [...dated].sort(
    (a, b) => a.date.localeCompare(b.date) || a.recipeName.localeCompare(b.recipeName),
  )[0];
  return {
    dueDate: addDays(earliest.date, -1),
    dinnerDate: earliest.date,
    recipeName: earliest.recipeName,
  };
}
