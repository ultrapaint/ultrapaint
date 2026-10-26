# Acme Inc: sign-in screen

## Purpose
A returning Acme Inc customer comes here to sign in to their account. Its main action is logging in with an email address and password. The screen also offers signing in with Apple, Google or Meta, a way to recover a forgotten password, and a link to sign up for people who don't have an account yet.

## Content

**Greeting:** welcomes the person back and says which account they are signing in to.
- Heading: "Welcome back"
- Subheading: "Login to your Acme Inc account"

**Email and password sign-in:** the main form.
- Field label "Email", with the example text "m@example.com"
- Field label "Password", with a hidden-text password field
- A link next to the password field: "Forgot your password?"
- Primary button: "Login"

**Other ways to sign in:** signing in with a third-party account.
- Divider text: "Or continue with"
- Three buttons, each showing only that company's logo. Their accessible labels are "Login with Apple", "Login with Google" and "Login with Meta".

**For people without an account:**
- "Don't have an account?" followed by the link "Sign up"

**Accompanying image:** a picture next to the form. In the capture it is an empty image placeholder with no subject, so the design can choose any image that suits signing in to Acme Inc. This appears only on desktop.

**Legal notice:** sits after the sign-in form and tells the person what they agree to by signing in.
- "By clicking continue, you agree to our Terms of Service and Privacy Policy." Both "Terms of Service" and "Privacy Policy" are links.

## Behaviour
- "Login" submits the email and password.
- "Forgot your password?" leads to password recovery.
- The Apple, Google and Meta buttons each start sign-in with that provider.
- "Sign up" leads to account creation.
- "Terms of Service" and "Privacy Policy" open those documents.
- The capture shows no error, loading or filled-in states. Both fields are empty, and the email field shows its example text.

## Viewports
Designed for a desktop window 1440 wide and a phone 390 wide. On the phone the accompanying image is left out. All other content is the same and in the same order.
