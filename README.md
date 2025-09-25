# 발주 관리 앱 (Order Management App)

A simple and effective order management application. This app allows you to register master data (customers, products) from Excel files, create new orders via search or barcode scanning, manage order history, and export orders to SMS, XLS, and DOCX formats.

This project was bootstrapped with Vite and is ready for deployment.

## Features

-   **Data Management**: Easily upload customer and product lists from Excel files.
-   **New Orders**: Intuitive interface to create new orders by searching for customers and products.
-   **Barcode Scanning**: Use your device's camera to scan product barcodes and add them to an order instantly.
-   **Order History**: View, search, and manage past orders with detailed views.
-   **Export**: Export order details in various formats:
    -   SMS for quick messaging.
    -   XLS (Excel) for spreadsheets.
    -   DOCX (Word) for printable documents.
-   **Data Backup & Restore**: Secure your data with JSON backup and restore functionality.
-   **Responsive Design**: Works on both desktop and mobile devices.

## Local Development

### Prerequisites

-   Node.js (v18 or higher recommended)
-   npm or yarn

### Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/<USERNAME>/<REPO_NAME>.git
    cd <REPO_NAME>
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run the development server:**
    ```bash
    npm run dev
    ```
    The application will be available at `http://localhost:3000`.

## Deployment to GitHub Pages

This project is configured for easy deployment to GitHub Pages.

1.  **Update `package.json`**:
    Open `package.json` and change the `homepage` field to your GitHub pages URL.
    ```json
    "homepage": "https://<USERNAME>.github.io/<REPO_NAME>",
    ```
    Replace `<USERNAME>` with your GitHub username and `<REPO_NAME>` with your repository name.

2.  **Update `vite.config.ts`**:
    Open `vite.config.ts` and change the `base` property to match your repository name.
    ```ts
    // ...
    export default defineConfig(({ mode }) => {
        // ...
        return {
          base: '/<REPO_NAME>/', // Change this to your repository name
          // ...
        };
    });
    ```
    Replace `<REPO_NAME>` with your repository name.

3.  **Deploy**:
    Run the deploy script. This will build the application and push the contents of the `dist` folder to a `gh-pages` branch on your repository.
    ```bash
    npm run deploy
    ```

4.  **Enable GitHub Pages**:
    In your GitHub repository settings, go to the "Pages" section and set the source to deploy from the `gh-pages` branch. Your app will be live at the URL specified in your `homepage` field.
