// FXNewsBias - Navigation hamburger menu
document.addEventListener('DOMContentLoaded', function () {

  const burger = document.querySelector('.burger');
  const navMenu = document.querySelector('nav ul');

  if (!burger || !navMenu) return;

  // Toggle menu on burger click
  burger.addEventListener('click', function () {
    const isOpen = navMenu.classList.contains('open');
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  // Close menu when clicking a nav link
  navMenu.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () {
      closeMenu();
    });
  });

  // Close menu when clicking outside
  document.addEventListener('click', function (e) {
    if (!burger.contains(e.target) && !navMenu.contains(e.target)) {
      closeMenu();
    }
  });

  function openMenu() {
    navMenu.classList.add('open');
    navMenu.style.display = 'flex';
    navMenu.style.flexDirection = 'column';
    navMenu.style.position = 'absolute';
    navMenu.style.top = '100%';
    navMenu.style.left = '0';
    navMenu.style.right = '0';
    navMenu.style.background = '#ffffff';
    navMenu.style.borderBottom = '1px solid #e5e7eb';
    navMenu.style.padding = '12px 20px';
    navMenu.style.gap = '4px';
    navMenu.style.zIndex = '999';
    navMenu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)';
    burger.innerHTML = '✕';
    // Make header relative for dropdown positioning
    const header = document.querySelector('header');
    if (header) header.style.position = 'relative';
  }

  function closeMenu() {
    navMenu.classList.remove('open');
    navMenu.style.display = '';
    burger.innerHTML = '☰';
  }

});
