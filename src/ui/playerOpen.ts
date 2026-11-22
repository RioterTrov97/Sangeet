let open = false;
/** PlayerScreen reports itself here: song taps never push a second player, and sheets render inside it (see ActionSheetHost). */
export const setPlayerOpen = (v: boolean) => {
  open = v;
};
export const isPlayerOpen = () => open;
