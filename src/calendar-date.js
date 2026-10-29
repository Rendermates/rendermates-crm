export function getCalendarDateHighlights(currentDate, year, monthIndex, dayNumber) {
  const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  return {
    isCurrentMonth: currentDate.startsWith(`${monthKey}-`),
    isToday: dayNumber != null && currentDate === `${monthKey}-${String(dayNumber).padStart(2, '0')}`,
  };
}
