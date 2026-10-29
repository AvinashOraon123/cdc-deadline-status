# CDC (CV) Deadline Status - IIT KGP

Chrome extension for the IIT KGP ERP placement grid. It colours each company row:

- **Green**: resume deadline still open
- **Red**: deadline passed
- **Yellow**: you have applied (Application Status = `Y`)

Yellow takes priority over green and red.

## Install

1. Download this repo (Code > Download ZIP) and unzip it, or `git clone` it.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the extension folder.
4. Open the ERP page (`https://erp.iitkgp.ac.in/IIT_ERP3/showmenu.htm`) and reload.

If you already have the Web Store version installed, disable it first so the two don't conflict.

## Configuration

Edit the constants at the top of `content.js`:

- `APPLIED_HEADER_TEXT`: header label of the status column
- `APPLIED_VALUES`: cell values treated as "applied"
