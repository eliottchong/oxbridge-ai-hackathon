<script lang="ts">
  export let name = 'grid';
  export let size = 20;
  const paths: Record<string, string> = {
    grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    flask: 'M9 3h6 M10 3v6L4 19a1.3 1.3 0 0 0 1 2h14a1.3 1.3 0 0 0 1-2L14 9V3 M7 15h10',
    box: 'm3 7 9-4 9 4v10l-9 4-9-4Z m0 0 9 4 9-4 M12 11v10 M7.5 5l9 4',
    card: 'M3 5h18v14H3z M3 10h18 M7 15h4',
    clock: 'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    arrow: 'M4 12h16 m-6-6 6 6-6 6',
    check: 'm5 12 4 4L19 6',
    plus: 'M12 5v14 M5 12h14',
    leaf: 'M20 3c0 12-2 17-9 17-9 0-9-12 0-13 4 0 6-2 9-4Z M4 21 16 9',
    shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z m-4 9 3 3 5-6',
    bolt: 'm13 2-9 12h7l-1 8 10-13h-8Z',
    chevron: 'm9 5 7 7-7 7',
    reset: 'M3 10a9 9 0 1 1 1 8 M3 4v6h6',
    spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
    close: 'm6 6 12 12 M6 18 18 6',
    link: 'm10 13 4-4 M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M14 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
    search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    download: 'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5',
  };
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name] || paths.grid} /></svg>
