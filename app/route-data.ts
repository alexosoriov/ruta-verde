export type Stop = {
  id: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  km: number;
};

// Orden calculado proyectando cada casa sobre la línea de recorrido del KML.
export const ROUTE_DISTANCE_KM = 4.509;

export const STOPS: Stop[] = [
  { id: "01", name: "Cinthya Marcela Del Rio Ojeda", address: "Aucaman Sur 4951", lat: -41.46187266, lng: -72.89822309, km: 0 },
  { id: "02", name: "Camila Arzola Montecinos", address: "Aucaman Sur 4957", lat: -41.46168134, lng: -72.8983155, km: 0.008 },
  { id: "03", name: "Vivianne Ponce Correa", address: "Los Pimientos 4806", lat: -41.46084004, lng: -72.89768542, km: 0.25 },
  { id: "04", name: "Mabel Von Johnn", address: "Los Pimientos 4820", lat: -41.46119168, lng: -72.89650941, km: 0.358 },
  { id: "05", name: "Jorge Llauca Lemus", address: "Los Pimientos 4828", lat: -41.4613983, lng: -72.89614207, km: 0.396 },
  { id: "06", name: "Yocelyn Baza", address: "Painecura 4601", lat: -41.46156371, lng: -72.89612492, km: 0.44 },
  { id: "07", name: "Guadalupe Alarcon", address: "Painecura 4602", lat: -41.46175273, lng: -72.89600091, km: 0.45 },
  { id: "08", name: "Jasna Marisol Quiroga Ruiz", address: "Alonqueo 4643", lat: -41.46358941, lng: -72.89270996, km: 0.903 },
  { id: "09", name: "Camila Barrera", address: "Millañir 4647", lat: -41.4631901, lng: -72.89266924, km: 1.075 },
  { id: "10", name: "Barbara Cordova", address: "Quintuillan 4619", lat: -41.46271966, lng: -72.89624242, km: 1.486 },
  { id: "11", name: "Victoria Jaramillo Guzman", address: "Quintuillan 4621", lat: -41.46277048, lng: -72.89627934, km: 1.492 },
  { id: "12", name: "Patricia Abarzua", address: "Quintuillan 4622", lat: -41.46300145, lng: -72.89623153, km: 1.511 },
  { id: "13", name: "Solange Medina Palma", address: "Calfuray 4675", lat: -41.46351762, lng: -72.89676206, km: 1.571 },
  { id: "14", name: "Marcela Inostroza", address: "Huechacura 4618", lat: -41.46280727, lng: -72.89669664, km: 1.668 },
  { id: "15", name: "Jenifer Romero", address: "Rucahue 4690", lat: -41.46179254, lng: -72.89720292, km: 1.818 },
  { id: "16", name: "Veronica Alejandra Soto Tellez", address: "Los Pimientos 4809", lat: -41.46069074, lng: -72.89754841, km: 1.987 },
  { id: "17", name: "Maria Paulina Quiñones Bustos", address: "Los Pimientos 4807", lat: -41.46064023, lng: -72.89765551, km: 1.998 },
  { id: "18", name: "Damaris Bello", address: "Los Pimientos 4803", lat: -41.46053737, lng: -72.89785231, km: 2.018 },
  { id: "19", name: "Ximena Cuevas Pinto", address: "Manquecura 4966", lat: -41.46009098, lng: -72.89739729, km: 2.149 },
  { id: "20", name: "Paulina Martinez Angel", address: "Chincolef 4962", lat: -41.45987139, lng: -72.89690694, km: 2.192 },
  { id: "21", name: "Ruth Barros", address: "Chincolef 4957", lat: -41.45966819, lng: -72.89698567, km: 2.208 },
  { id: "22", name: "Jessica Araneda D.", address: "Huichalef 4926", lat: -41.45973622, lng: -72.89679885, km: 2.21 },
  { id: "23", name: "Victor Riquelme", address: "Manquecura 4964", lat: -41.46027066, lng: -72.8969963, km: 2.375 },
  { id: "24", name: "Armandina Salazar", address: "Huechuman 4965", lat: -41.46024943, lng: -72.89756917, km: 2.454 },
  { id: "25", name: "Nataly Andrea Barraza Araya", address: "Huechuman 4966", lat: -41.46039437, lng: -72.89771004, km: 2.456 },
  { id: "26", name: "Maria Cristina Leiva", address: "Painemilla 5085", lat: -41.45951223, lng: -72.89813325, km: 2.636 },
  { id: "27", name: "Lorena Alarcon", address: "Painemilla 5028", lat: -41.45981236, lng: -72.9003612, km: 2.826 },
  { id: "28", name: "Daniel Medina Salas", address: "Curamil 4781", lat: -41.45995273, lng: -72.90035065, km: 2.841 },
  { id: "29", name: "Daniel Medina", address: "Pasaje Curamil 4781", lat: -41.46028179, lng: -72.90014894, km: 2.877 },
  { id: "30", name: "Vilma Navarro", address: "Curamil 4770", lat: -41.46041216, lng: -72.90008217, km: 2.89 },
  { id: "31", name: "Alicia Barros", address: "Llancamil 5001", lat: -41.46088229, lng: -72.90099584, km: 3.064 },
  { id: "32", name: "Felipe Casanova Vera", lat: -41.46008343, lng: -72.90106683, km: 3.269 },
  { id: "33", name: "Cecilia Caro", address: "Painemilla 5003", lat: -41.45972732, lng: -72.90289923, km: 3.541 },
  { id: "34", name: "Maria Isabel Vera Hernandez", address: "Huenchumilla 4981", lat: -41.46002975, lng: -72.90207642, km: 3.622 },
  { id: "35", name: "Pamela Palma Muñoz", address: "Choshuenco 4999", lat: -41.46035119, lng: -72.90226384, km: 3.657 },
  { id: "36", name: "Andrea Muñoz", address: "Choshuenco 4990", lat: -41.46054917, lng: -72.90245201, km: 3.684 },
  { id: "37", name: "Macarena Selman", address: "Lepihue 5143", lat: -41.46051246, lng: -72.90296644, km: 3.738 },
  { id: "38", name: "Marjorie Erazo Prat", address: "Lepihue 5121", lat: -41.45985127, lng: -72.90410084, km: 3.858 },
  { id: "39", name: "Pamela Asencio Zúñiga", address: "Arquén 5063", lat: -41.46177683, lng: -72.90516808, km: 4.213 },
  { id: "40", name: "Maribel Zúñiga Tobar", address: "Pasaje Montahue 5089", lat: -41.46066159, lng: -72.90466345, km: 4.376 },
  { id: "41", name: "Carmen Gloria", address: "Lepihue 5084", lat: -41.46033735, lng: -72.90546826, km: 4.509 },
];
