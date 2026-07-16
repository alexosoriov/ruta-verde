export type Stop = {
  id: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  km: number;
};

// Distancia base calculada proyectando cada vivienda sobre la línea del KML.
export const ROUTE_DISTANCE_KM = 4.509;

function stop(id: string, address: string | undefined, lat: number, lng: number, km: number): Stop {
  return {
    id,
    name: `Vivienda ${id}`,
    address,
    lat,
    lng,
    km,
  };
}

// No se almacenan nombres de residentes en el código cliente.
// Las direcciones y coordenadas siguen siendo datos operacionales sensibles:
// el repositorio y el despliegue deben permanecer privados.
export const STOPS: Stop[] = [
  stop("01", "Aucaman Sur 4951", -41.46187266, -72.89822309, 0),
  stop("02", "Aucaman Sur 4957", -41.46168134, -72.8983155, 0.008),
  stop("03", "Los Pimientos 4806", -41.46084004, -72.89768542, 0.25),
  stop("04", "Los Pimientos 4820", -41.46119168, -72.89650941, 0.358),
  stop("05", "Los Pimientos 4828", -41.4613983, -72.89614207, 0.396),
  stop("06", "Painecura 4601", -41.46156371, -72.89612492, 0.44),
  stop("07", "Painecura 4602", -41.46175273, -72.89600091, 0.45),
  stop("08", "Alonqueo 4643", -41.46358941, -72.89270996, 0.903),
  stop("09", "Millañir 4647", -41.4631901, -72.89266924, 1.075),
  stop("10", "Quintuillan 4619", -41.46271966, -72.89624242, 1.486),
  stop("11", "Quintuillan 4621", -41.46277048, -72.89627934, 1.492),
  stop("12", "Quintuillan 4622", -41.46300145, -72.89623153, 1.511),
  stop("13", "Calfuray 4675", -41.46351762, -72.89676206, 1.571),
  stop("14", "Huechacura 4618", -41.46280727, -72.89669664, 1.668),
  stop("15", "Rucahue 4690", -41.46179254, -72.89720292, 1.818),
  stop("16", "Los Pimientos 4809", -41.46069074, -72.89754841, 1.987),
  stop("17", "Los Pimientos 4807", -41.46064023, -72.89765551, 1.998),
  stop("18", "Los Pimientos 4803", -41.46053737, -72.89785231, 2.018),
  stop("19", "Manquecura 4966", -41.46009098, -72.89739729, 2.149),
  stop("20", "Chincolef 4962", -41.45987139, -72.89690694, 2.192),
  stop("21", "Chincolef 4957", -41.45966819, -72.89698567, 2.208),
  stop("22", "Huichalef 4926", -41.45973622, -72.89679885, 2.21),
  stop("23", "Manquecura 4964", -41.46027066, -72.8969963, 2.375),
  stop("24", "Huechuman 4965", -41.46024943, -72.89756917, 2.454),
  stop("25", "Huechuman 4966", -41.46039437, -72.89771004, 2.456),
  stop("26", "Painemilla 5085", -41.45951223, -72.89813325, 2.636),
  stop("27", "Painemilla 5028", -41.45981236, -72.9003612, 2.826),
  stop("28", "Curamil 4781", -41.45995273, -72.90035065, 2.841),
  stop("29", "Pasaje Curamil 4781", -41.46028179, -72.90014894, 2.877),
  stop("30", "Curamil 4770", -41.46041216, -72.90008217, 2.89),
  stop("31", "Llancamil 5001", -41.46088229, -72.90099584, 3.064),
  stop("32", undefined, -41.46008343, -72.90106683, 3.269),
  stop("33", "Painemilla 5003", -41.45972732, -72.90289923, 3.541),
  stop("34", "Huenchumilla 4981", -41.46002975, -72.90207642, 3.622),
  stop("35", "Choshuenco 4999", -41.46035119, -72.90226384, 3.657),
  stop("36", "Choshuenco 4990", -41.46054917, -72.90245201, 3.684),
  stop("37", "Lepihue 5143", -41.46051246, -72.90296644, 3.738),
  stop("38", "Lepihue 5121", -41.45985127, -72.90410084, 3.858),
  stop("39", "Arquén 5063", -41.46177683, -72.90516808, 4.213),
  stop("40", "Pasaje Montahue 5089", -41.46066159, -72.90466345, 4.376),
  stop("41", "Lepihue 5084", -41.46033735, -72.90546826, 4.509),
];
